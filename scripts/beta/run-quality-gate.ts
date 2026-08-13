import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  sha256,
  type BetaCommandResult,
  type BetaCommandRunner,
  type BetaGateCommand,
} from '../../src/shared/testing/beta-local-evidence'
import { localStackPlaywrightEnv } from '../../src/shared/testing/local-stack-playwright-env'
import { spawnBetaCommand } from './command-runner'

export const QUALITY_STEP_IDS = [
  'format',
  'lint',
  'typecheck',
  'unit',
  'integration',
  'build-web',
  'build-worker',
  'component-a11y',
  'storybook-browser',
  'stack-up',
  'critical-browser',
  'full-browser',
  'stack-down',
] as const

const STATIC_STEPS: readonly Readonly<{
  id: (typeof QUALITY_STEP_IDS)[number]
  command: BetaGateCommand
}>[] = [
  { id: 'format', command: { executable: 'pnpm', args: ['format:check'] } },
  { id: 'lint', command: { executable: 'pnpm', args: ['lint'] } },
  { id: 'typecheck', command: { executable: 'pnpm', args: ['typecheck'] } },
  { id: 'unit', command: { executable: 'pnpm', args: ['test:unit'] } },
  {
    id: 'integration',
    command: { executable: 'pnpm', args: ['test:integration'] },
  },
  { id: 'build-web', command: { executable: 'pnpm', args: ['build'] } },
  {
    id: 'build-worker',
    command: { executable: 'pnpm', args: ['build:worker'] },
  },
  {
    id: 'component-a11y',
    command: { executable: 'pnpm', args: ['test:storybook'] },
  },
  {
    id: 'storybook-browser',
    command: {
      executable: 'pnpm',
      args: ['exec', 'tsx', 'scripts/beta/run-storybook-gate.ts'],
    },
  },
]

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function writeStepEvidence(
  outputDir: string,
  id: string,
  command: BetaGateCommand,
  result: BetaCommandResult,
): Readonly<{ id: string; resultSha256: string; logSha256: string }> {
  const log = `${result.stdout}\n--- STDERR ---\n${result.stderr}`
  const logSha256 = sha256(log)
  const resultContent = canonicalJson({
    schemaVersion: 'beta-local-1',
    evidenceKind: 'beta-quality-step',
    id,
    command,
    exitCode: result.exitCode,
    passed: result.exitCode === 0,
    log: `${id}.log`,
    logSha256,
  })
  writeFileSync(resolve(outputDir, `${id}.log`), log, {
    encoding: 'utf8',
    flag: 'wx',
  })
  writeFileSync(resolve(outputDir, `${id}.json`), resultContent, {
    encoding: 'utf8',
    flag: 'wx',
  })
  return { id, resultSha256: sha256(resultContent), logSha256 }
}

export async function runQualityGate(
  args: readonly string[],
  runner: BetaCommandRunner = spawnBetaCommand,
): Promise<number> {
  const outputArg = flagValue(args, '--output-dir')
  const sourceRevision = flagValue(args, '--source-revision')
  if (!outputArg || !sourceRevision || !/^[0-9a-f]{40,64}$/.test(sourceRevision)) {
    console.error(
      'Usage: --output-dir=<directory> --source-revision=<lowercase hex revision>',
    )
    return 2
  }
  const outputDir = resolve(outputArg)
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const results: Array<
    Readonly<{ id: string; resultSha256: string; logSha256: string }>
  > = []

  for (const step of STATIC_STEPS) {
    const result = await runner(step.command)
    results.push(writeStepEvidence(outputDir, step.id, step.command, result))
    if (result.exitCode !== 0) return result.exitCode || 1
  }

  const stackUp: BetaGateCommand = {
    executable: 'pnpm',
    args: ['e2e:stack:up'],
  }
  const upResult = await runner(stackUp)
  results.push(writeStepEvidence(outputDir, 'stack-up', stackUp, upResult))

  let browserExitCode = upResult.exitCode === 0 ? 0 : upResult.exitCode || 1
  try {
    if (browserExitCode === 0) {
      const browserEnvironment = {
        ...process.env,
        ...localStackPlaywrightEnv(
          resolve(process.cwd(), '.local-stack', 'e2e', 'stack.env'),
        ),
      }
      for (const step of [
        {
          id: 'critical-browser',
          command: {
            executable: 'pnpm',
            args: ['test:e2e', '--project=critical'],
          },
        },
        {
          id: 'full-browser',
          command: { executable: 'pnpm', args: ['test:e2e', '--project=full'] },
        },
      ] as const) {
        const result = await runner(step.command, { env: browserEnvironment })
        results.push(writeStepEvidence(outputDir, step.id, step.command, result))
        if (result.exitCode !== 0) {
          browserExitCode = result.exitCode || 1
          break
        }
      }
    }
  } finally {
    const stackDown: BetaGateCommand = {
      executable: 'pnpm',
      args: ['e2e:stack:down'],
    }
    const downResult = await runner(stackDown)
    results.push(writeStepEvidence(outputDir, 'stack-down', stackDown, downResult))
    if (downResult.exitCode !== 0 && browserExitCode === 0)
      browserExitCode = downResult.exitCode || 1
  }
  if (browserExitCode !== 0) return browserExitCode

  const indexContent = canonicalJson({
    schemaVersion: 'beta-local-1',
    evidenceKind: 'beta-quality-gate',
    sourceRevision,
    steps: results,
  })
  const indexPath = resolve(outputDir, 'quality.json')
  const digest = sha256(indexContent)
  writeFileSync(indexPath, indexContent, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(`${indexPath}.sha256`, `${digest}  ${basename(indexPath)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runQualityGate(process.argv.slice(2))
}
