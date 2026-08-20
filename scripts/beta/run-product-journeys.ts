import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  sha256,
  type BetaCommandRunner,
  type BetaCommandResult,
} from '../../src/shared/testing/beta-local-evidence'
import { spawnBetaCommand } from './command-runner'
import { localStackPlaywrightEnv } from '../../src/shared/testing/local-stack-playwright-env'

const STACK_CONTROLLER = 'scripts/local-stack/stack.ts'
const PRODUCT_SPEC = 'e2e/critical/beta-product-journeys.spec.ts'

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

export function createProductJourneyBrowserEnvironment(
  stackEnvPath: string,
  parentEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...parentEnvironment,
    ...localStackPlaywrightEnv(stackEnvPath),
  }
}

export async function runProductJourneys(
  args: readonly string[],
  runner: BetaCommandRunner = spawnBetaCommand,
): Promise<number> {
  const outputArg = flagValue(args, '--output')
  const sourceRevision = flagValue(args, '--source-revision')
  if (!outputArg || !sourceRevision || !/^[0-9a-f]{40,64}$/.test(sourceRevision)) {
    console.error(
      'Usage: --output=<product-journeys.json> --source-revision=<lowercase hex revision>',
    )
    return 2
  }
  const output = resolve(outputArg)
  const checksum = `${output}.sha256`
  const report = `${output}.report.json`
  rmSync(output, { force: true })
  rmSync(checksum, { force: true })
  rmSync(report, { force: true })

  const upResult = await runner({
    executable: 'pnpm',
    args: ['exec', 'tsx', STACK_CONTROLLER, 'up', '--mode=beta'],
  })

  let journeyResult: BetaCommandResult | undefined
  let downResult: BetaCommandResult | undefined
  try {
    if (upResult.exitCode === 0) {
      journeyResult = await runner(
        {
          executable: 'pnpm',
          args: [
            'exec',
            'playwright',
            'test',
            PRODUCT_SPEC,
            '--project=critical',
            '--reporter=json',
          ],
        },
        {
          env: createProductJourneyBrowserEnvironment(
            resolve('.local-stack', 'beta', 'stack.env'),
          ),
        },
      )
    }
  } finally {
    downResult = await runner({
      executable: 'pnpm',
      args: ['exec', 'tsx', STACK_CONTROLLER, 'down', '--mode=beta'],
    })
  }
  if (upResult.exitCode !== 0) return upResult.exitCode || 1
  if (!journeyResult || !downResult)
    throw new Error('Product journey runner did not return a result')
  if (journeyResult.exitCode !== 0) return journeyResult.exitCode || 1
  if (downResult.exitCode !== 0) return downResult.exitCode || 1

  const evidence = canonicalJson({
    schemaVersion: 'beta-local-1',
    evidenceKind: 'promoted-browser-product-journeys',
    sourceRevision,
    report: basename(report),
    reportSha256: sha256(journeyResult.stdout),
    productContractSha256: sha256(readFileSync(resolve(PRODUCT_SPEC))),
    command: {
      executable: 'pnpm',
      args: [
        'exec',
        'playwright',
        'test',
        PRODUCT_SPEC,
        '--project=critical',
        '--reporter=json',
      ],
    },
    passed: true,
    exitCode: 0,
    stdoutSha256: sha256(journeyResult.stdout),
    stderrSha256: sha256(journeyResult.stderr),
  })
  const digest = sha256(evidence)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(report, journeyResult.stdout, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(output, evidence, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(checksum, `${digest}  ${basename(output)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runProductJourneys(process.argv.slice(2))
}
