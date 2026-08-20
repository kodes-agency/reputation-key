import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  executeBetaSmokeGates,
  persistBetaSmokeManifest,
  sha256,
  type BetaCommandRunner,
  type BetaGatePlan,
  type BetaSmokeIdentity,
} from '../../src/shared/testing/beta-local-evidence'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import { spawnBetaCommand } from './command-runner'
import { createPreCutoverDump } from './create-pre-cutover-dump'

const DEFAULT_OUTPUT_ROOT = 'test-results/beta-smoke'
const STACK_CONTROLLER = 'scripts/local-stack/stack.ts'
const GATE_VERIFIER = 'scripts/beta/verify-gate-evidence.ts'
const PRODUCT_JOURNEY_RUNNER = 'scripts/beta/run-product-journeys.ts'

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  const value = args.find((arg) => arg.startsWith(prefix))
  return value?.slice(prefix.length)
}
function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value))
    throw new Error(`${label} must be a JSON object`)
  return value as Record<string, unknown>
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase sha256`)
  return value
}

function migrationHeadTag(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value
  const proof = objectValue(value, label)
  if (typeof proof.expectedTag !== 'string' || !proof.expectedTag.trim())
    throw new Error(`${label} is missing expectedTag`)
  return proof.expectedTag
}

export function createStackAcceptanceCommand(
  preCutoverDump: string,
): Readonly<{ executable: string; args: readonly string[] }> {
  return {
    executable: 'pnpm',
    args: [
      'exec',
      'tsx',
      STACK_CONTROLLER,
      'acceptance',
      '--mode=beta',
      `--pre-cutover-dump=${preCutoverDump}`,
    ],
  }
}

export function buildBetaSmokeIdentity(options: {
  releaseSha: string
  acceptance: Record<string, unknown>
  lockfileContent: Uint8Array
  productContractContent: Uint8Array
  inspectedImageIds: Readonly<Record<string, string>>
}): BetaSmokeIdentity {
  const sourceRevision = options.acceptance.sourceRevision
  if (typeof sourceRevision !== 'string' || !/^[0-9a-f]{40,64}$/.test(sourceRevision))
    throw new Error('acceptance-index.json has invalid sourceRevision')
  if (sourceRevision !== options.releaseSha)
    throw new Error('release SHA does not match observed stack source revision')
  const imageEvidence = objectValue(
    options.acceptance.images,
    'acceptance-index.json images',
  )
  const imageDigests: Record<string, string> = {}
  for (const name of ['web', 'worker', 'provider', 'perf']) {
    const image = objectValue(imageEvidence[name], `acceptance image ${name}`)
    if (typeof image.imageId !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(image.imageId))
      throw new Error(`acceptance image ${name} has invalid imageId`)
    if (image.revisionLabel !== sourceRevision)
      throw new Error(`acceptance image ${name} has mismatched revision label`)
    if (options.inspectedImageIds[name] !== image.imageId)
      throw new Error(`acceptance image ${name} does not match docker inspect`)
    imageDigests[name] = image.imageId
  }
  return {
    releaseSha: options.releaseSha,
    sourceRevision,
    lockfileRevision: sha256(options.lockfileContent),
    cleanMigrationHead: migrationHeadTag(
      options.acceptance.cleanMigrationHead,
      'cleanMigrationHead',
    ),
    upgradeMigrationHead: migrationHeadTag(
      options.acceptance.upgradeMigrationHead,
      'upgradeMigrationHead',
    ),
    capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
    stackContractHash: requiredSha256(
      options.acceptance.stackContractSha256,
      'stackContractSha256',
    ),
    productHash: sha256(options.productContractContent),
    scaleHash: requiredSha256(
      options.acceptance.scaleFixtureSha256,
      'scaleFixtureSha256',
    ),
    fleetHash: requiredSha256(
      options.acceptance.fleetFixtureSha256,
      'fleetFixtureSha256',
    ),
    imageDigests,
  }
}

export async function deriveBetaSmokeIdentity(options: {
  releaseSha: string
  runner: BetaCommandRunner
  workRoot: string
}): Promise<BetaSmokeIdentity> {
  const acceptancePath = resolve(
    'test-results/local-stack/beta/acceptance/acceptance-index.json',
  )
  const acceptanceContent = readFileSync(acceptancePath, 'utf8')
  const acceptance = objectValue(
    JSON.parse(acceptanceContent) as unknown,
    'acceptance-index.json',
  )
  const sourceRevision = String(acceptance.sourceRevision ?? '')
  const imageTags: Readonly<Record<string, string>> = {
    web: `repkey-local-web:${sourceRevision}`,
    worker: `repkey-local-worker:${sourceRevision}`,
    provider: `repkey-local-provider:${sourceRevision}`,
    perf: `repkey-local-perf:${sourceRevision}`,
  }
  const inspectedImageIds: Record<string, string> = {}
  for (const name of ['web', 'worker', 'provider', 'perf']) {
    const inspected = await options.runner({
      executable: 'docker',
      args: ['image', 'inspect', imageTags[name] ?? '', '--format={{.Id}}'],
    })
    if (inspected.exitCode !== 0)
      throw new Error(`docker inspect failed for beta image ${name}`)
    inspectedImageIds[name] = inspected.stdout.trim()
  }
  const identity = buildBetaSmokeIdentity({
    releaseSha: options.releaseSha,
    acceptance,
    lockfileContent: readFileSync(resolve('pnpm-lock.yaml')),
    productContractContent: readFileSync(
      resolve('e2e/critical/beta-product-journeys.spec.ts'),
    ),
    inspectedImageIds,
  })
  const observation = canonicalJson({
    schemaVersion: 'beta-local-1',
    evidenceKind: 'observed-beta-smoke-identity',
    identity,
    acceptanceIndexSha256: sha256(acceptanceContent),
  })
  const observationPath = resolve(options.workRoot, 'identity-observation.json')
  const observationSha256 = sha256(observation)
  writeFileSync(observationPath, observation, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(
    `${observationPath}.sha256`,
    `${observationSha256}  ${basename(observationPath)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  )
  return identity
}
export function createBetaSmokeGatePlan(
  identity: BetaSmokeIdentity,
): readonly BetaGatePlan[] {
  // The quality phase used to re-run the entire gate list here — format, lint,
  // typecheck, unit, integration, three builds, both storybook gates and BOTH
  // Playwright projects — on top of a Compose stack of its own. Every one of
  // those is already proven on this exact SHA by this job's own `needs`
  // (check, docker, storybook, storybook-test, e2e), so it was ~30 minutes of
  // re-proving passed work and it made this the long pole of CI at a median of
  // 58 minutes. What remains below is the work nothing else does: the
  // beta-profile Compose lifecycles and their evidence.
  const workRoot = join('test-results', 'beta-smoke-work', identity.releaseSha)
  const acceptanceRoot = join('test-results', 'local-stack', 'beta', 'acceptance')
  const securityEvidence = join(workRoot, 'security-privacy.json')
  const sourceEvidence = join(workRoot, 'source-lifecycle.json')
  const productEvidence = join(workRoot, 'product-journeys.json')
  const identityEvidence = join(workRoot, 'identity-observation.json')
  const cleanEvidence = join(acceptanceRoot, 'clean-smoke.json')
  const scaleEvidence = join(acceptanceRoot, 'scale.json')
  const faultEvidence = join(acceptanceRoot, 'faults.json')
  const upgradeEvidence = join(acceptanceRoot, 'upgrade.json')
  const acceptanceIndex = join(acceptanceRoot, 'acceptance-index.json')

  return [
    {
      id: 'security-privacy',
      command: {
        executable: 'pnpm',
        args: [
          'exec',
          'vitest',
          'run',
          '--project=unit',
          'src/shared/auth/beta-capabilities.test.ts',
          'src/shared/auth/capability-denial.test.ts',
          'src/contexts/guest/server/guest-session.test.ts',
          'src/contexts/guest/application/use-cases/guest-response-lifecycle.test.ts',
          '--reporter=json',
          `--outputFile=${securityEvidence}`,
        ],
      },
      evidence: [securityEvidence],
    },
    {
      id: 'local-scale-recovery',
      command: {
        executable: 'pnpm',
        args: ['exec', 'tsx', GATE_VERIFIER, '--kind=scale', `--path=${scaleEvidence}`],
      },
      evidence: [scaleEvidence],
    },
    {
      id: 'source-lifecycle',
      command: {
        executable: 'pnpm',
        args: [
          'exec',
          'vitest',
          'run',
          '--project=unit',
          'src/contexts/review/application/source-content-lifecycle.test.ts',
          'src/shared/jobs/retention-sweep.job.test.ts',
          '--reporter=json',
          `--outputFile=${sourceEvidence}`,
        ],
      },
      evidence: [sourceEvidence],
    },
    {
      id: 'runtime-fault-matrix',
      command: {
        executable: 'pnpm',
        args: ['exec', 'tsx', GATE_VERIFIER, '--kind=faults', `--path=${faultEvidence}`],
      },
      evidence: [faultEvidence],
    },
    {
      id: 'migration-upgrade',
      command: {
        executable: 'pnpm',
        args: [
          'exec',
          'tsx',
          GATE_VERIFIER,
          '--kind=migration',
          `--clean=${cleanEvidence}`,
          `--upgrade=${upgradeEvidence}`,
        ],
      },
      evidence: [cleanEvidence, upgradeEvidence],
    },
    {
      id: 'product-journeys',
      command: {
        executable: 'pnpm',
        args: [
          'exec',
          'tsx',
          PRODUCT_JOURNEY_RUNNER,
          `--output=${productEvidence}`,
          `--source-revision=${identity.sourceRevision}`,
        ],
      },
      evidence: [productEvidence, `${productEvidence}.report.json`],
    },
    {
      id: 'release-bundle',
      command: {
        executable: 'pnpm',
        args: [
          'exec',
          'tsx',
          GATE_VERIFIER,
          '--kind=release-bundle',
          `--acceptance-index=${acceptanceIndex}`,
          `--clean=${cleanEvidence}`,
          `--scale=${scaleEvidence}`,
          `--faults=${faultEvidence}`,
          `--upgrade=${upgradeEvidence}`,
          `--product=${productEvidence}`,
          `--identity-observation=${identityEvidence}`,
        ],
      },
      evidence: [acceptanceIndex, identityEvidence],
    },
  ]
}

export async function runBetaSmokeCli(
  args: readonly string[],
  runner: BetaCommandRunner = spawnBetaCommand,
): Promise<number> {
  try {
    const revisionResult = await runner({
      executable: 'git',
      args: ['rev-parse', 'HEAD'],
    })
    const observedRevision = revisionResult.stdout.trim()
    if (revisionResult.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(observedRevision))
      throw new Error('Could not derive a lowercase source revision')
    const requestedReleaseSha = flagValue(args, '--release-sha')
    if (requestedReleaseSha && requestedReleaseSha !== observedRevision)
      throw new Error('--release-sha does not match the current source revision')
    const releaseSha = requestedReleaseSha ?? observedRevision
    const outputRoot = resolve(flagValue(args, '--output-root') ?? DEFAULT_OUTPUT_ROOT)
    if (existsSync(join(outputRoot, releaseSha)))
      throw new Error(`release SHA ${releaseSha} already has smoke evidence`)
    const preCutoverDumpArg = flagValue(args, '--pre-cutover-dump')
    const preCutoverDump = preCutoverDumpArg
      ? resolve(preCutoverDumpArg)
      : createPreCutoverDump().path
    const workRoot = resolve('test-results', 'beta-smoke-work', releaseSha)
    rmSync(workRoot, { recursive: true, force: true })
    mkdirSync(workRoot, { recursive: true })

    const acceptanceResult = await runner(createStackAcceptanceCommand(preCutoverDump))
    if (acceptanceResult.exitCode !== 0) {
      console.error(
        `beta smoke stack acceptance failed (exit ${acceptanceResult.exitCode})`,
      )
      return 1
    }
    const identity = await deriveBetaSmokeIdentity({
      releaseSha,
      runner,
      workRoot,
    })
    const plan = createBetaSmokeGatePlan(identity)
    const execution = await executeBetaSmokeGates({
      identity,
      plan,
      readEvidence: (path) => readFileSync(resolve(path)),
      runner,
    })
    if (!execution.ok) {
      console.error(
        `beta smoke failed at ${execution.failedGate} (exit ${execution.exitCode}): ${execution.stderr}`,
      )
      return 1
    }
    const persisted = persistBetaSmokeManifest({
      outputRoot,
      manifest: execution.manifest,
    })
    console.log(
      `beta smoke passed: ${persisted.manifestPath} (${persisted.manifestSha256})`,
    )
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBetaSmokeCli(process.argv.slice(2))
}
