import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  persistBetaSmokeManifest,
  sha256,
  type BetaCommandRunner,
  type BetaGateEvidence,
  type BetaGatePlan,
  type BetaGateResult,
  type BetaLocalGateId,
  type BetaSmokeIdentity,
  type BetaSmokeManifest,
} from '../../src/shared/testing/beta-local-evidence'
import {
  BETA_LOCAL_EVIDENCE_VERSION,
  REQUIRED_BETA_LOCAL_GATE_IDS,
} from '../../src/shared/testing/release-bundle'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import { spawnBetaCommand } from './command-runner'
import { createPreCutoverDump } from './create-pre-cutover-dump'

const DEFAULT_OUTPUT_ROOT = 'test-results/beta-smoke'
const STACK_CONTROLLER = 'scripts/local-stack/stack.ts'
const GATE_VERIFIER = 'scripts/beta/verify-gate-evidence.ts'
const PRODUCT_JOURNEY_RUNNER = 'scripts/beta/run-product-journeys.ts'
const STACK_ACCEPTANCE_ROOT = join('test-results', 'local-stack', 'beta', 'acceptance')
const STACK_SCENARIOS = ['clean-smoke', 'scale', 'faults', 'upgrade'] as const

type BetaStackScenario = (typeof STACK_SCENARIOS)[number]

export const BETA_SMOKE_SCENARIO_GROUPS = [
  'clean-faults',
  'scale-source',
  'upgrade-product',
] as const

export type BetaSmokeScenarioGroup = (typeof BETA_SMOKE_SCENARIO_GROUPS)[number]

type BetaSmokeScenarioGroupDefinition = Readonly<{
  scenarios: readonly BetaStackScenario[]
  gates: readonly BetaLocalGateId[]
}>

const GROUP_DEFINITIONS: Readonly<
  Record<BetaSmokeScenarioGroup, BetaSmokeScenarioGroupDefinition>
> = {
  // Measured on main run 33891370093: clean 202s + cached faults 153s.
  'clean-faults': {
    scenarios: ['clean-smoke', 'faults'],
    gates: ['security-privacy', 'runtime-fault-matrix'],
  },
  // Measured on the same run: cached scale 193s; source tests add ~2s.
  'scale-source': {
    scenarios: ['scale'],
    gates: ['local-scale-recovery', 'source-lifecycle'],
  },
  // Upgrade and product journeys share the row's image cache: 48s + 191s.
  'upgrade-product': {
    scenarios: ['upgrade'],
    gates: ['product-journeys'],
  },
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw new Error(`${label} must be a sha256 digest`)
  return value
}

function migrationHeadTag(value: unknown, label: string): string {
  const head = objectValue(value, label)
  if (typeof head.expectedTag !== 'string' || head.expectedTag.length === 0)
    throw new Error(`${label}.expectedTag is required`)
  return head.expectedTag
}

function smokeWorkRoot(releaseSha: string): string {
  return resolve('test-results', 'beta-smoke-work', releaseSha)
}

function fragmentRoot(releaseSha: string): string {
  return resolve('test-results', 'beta-smoke-fragments', releaseSha)
}

function scenarioEvidencePath(scenario: BetaStackScenario): string {
  return resolve(STACK_ACCEPTANCE_ROOT, `${scenario}.json`)
}

function fragmentScenarioPath(releaseSha: string, scenario: BetaStackScenario): string {
  return join(fragmentRoot(releaseSha), 'scenarios', `${scenario}.json`)
}

function checksummedContent(path: string): Readonly<{ content: string; digest: string }> {
  const content = readFileSync(path, 'utf8')
  const digest = sha256(content)
  const expected = `${digest}  ${basename(path)}\n`
  const checksum = readFileSync(`${path}.sha256`, 'utf8')
  if (checksum !== expected)
    throw new Error(`${path}.sha256 does not match ${basename(path)}`)
  return { content, digest }
}

function writeChecksummed(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(`${path}.sha256`, `${sha256(content)}  ${basename(path)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
}

function copyChecksummed(source: string, destination: string): void {
  checksummedContent(source)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  copyFileSync(`${source}.sha256`, `${destination}.sha256`)
  checksummedContent(destination)
}

function parsedJson(path: string, label: string): Record<string, unknown> {
  return objectValue(JSON.parse(readFileSync(path, 'utf8')) as unknown, label)
}

export function betaSmokeScenarioGroupDefinition(
  group: BetaSmokeScenarioGroup,
): BetaSmokeScenarioGroupDefinition {
  return GROUP_DEFINITIONS[group]
}

export function createStackScenarioCommand(
  scenario: BetaStackScenario,
  preCutoverDump?: string,
): Readonly<{ executable: string; args: readonly string[] }> {
  if (scenario === 'upgrade' && !preCutoverDump)
    throw new Error('upgrade scenario requires a pre-cutover dump')
  const args = ['exec', 'tsx', STACK_CONTROLLER, scenario, '--mode=beta']
  if (scenario === 'upgrade') args.push(`--pre-cutover-dump=${preCutoverDump}`)
  return { executable: 'pnpm', args }
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

export function createBetaSmokeGatePlan(
  identity: Pick<BetaSmokeIdentity, 'releaseSha' | 'sourceRevision'>,
): readonly BetaGatePlan[] {
  // The heavy beta-only work is distributed across the three scenario rows.
  // This remains the single authority for all seven commands and evidence paths;
  // the aggregate verifies each staged result against this exact plan before it
  // writes the immutable manifest.
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

async function observedReleaseSha(
  args: readonly string[],
  runner: BetaCommandRunner,
): Promise<string> {
  const revisionResult = await runner({ executable: 'git', args: ['rev-parse', 'HEAD'] })
  const observedRevision = revisionResult.stdout.trim()
  if (revisionResult.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(observedRevision))
    throw new Error('Could not derive a lowercase source revision')
  const requestedReleaseSha = flagValue(args, '--release-sha')
  if (requestedReleaseSha && requestedReleaseSha !== observedRevision)
    throw new Error('--release-sha does not match the current source revision')
  return requestedReleaseSha ?? observedRevision
}

function stageScenarioEvidence(releaseSha: string, scenario: BetaStackScenario): void {
  copyChecksummed(
    scenarioEvidencePath(scenario),
    fragmentScenarioPath(releaseSha, scenario),
  )
}

function materializeScenarioEvidence(releaseSha: string): void {
  mkdirSync(resolve(STACK_ACCEPTANCE_ROOT), { recursive: true })
  for (const scenario of STACK_SCENARIOS) {
    copyChecksummed(
      fragmentScenarioPath(releaseSha, scenario),
      scenarioEvidencePath(scenario),
    )
  }
}

function pathInside(root: string, candidate: string): string | undefined {
  const fromRoot = relative(root, candidate)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`))
    return undefined
  return fromRoot
}

function stageGateEvidence(
  releaseSha: string,
  evidence: readonly BetaGateEvidence[],
): void {
  const workRoot = smokeWorkRoot(releaseSha)
  for (const item of evidence) {
    const source = resolve(item.path)
    const relativePath = pathInside(workRoot, source)
    if (!relativePath) continue
    const destination = join(fragmentRoot(releaseSha), 'evidence', relativePath)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    if (existsSync(`${source}.sha256`)) {
      copyFileSync(`${source}.sha256`, `${destination}.sha256`)
    }
  }
}

function materializeGateEvidence(
  releaseSha: string,
  evidence: readonly BetaGateEvidence[],
): void {
  const workRoot = smokeWorkRoot(releaseSha)
  for (const item of evidence) {
    const destination = resolve(item.path)
    const relativePath = pathInside(workRoot, destination)
    if (relativePath) {
      const source = join(fragmentRoot(releaseSha), 'evidence', relativePath)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      if (existsSync(`${source}.sha256`)) {
        copyFileSync(`${source}.sha256`, `${destination}.sha256`)
      }
    }
    if (sha256(readFileSync(destination)) !== item.sha256)
      throw new Error(`staged gate evidence digest mismatch: ${item.path}`)
  }
}

async function executeGate(
  gate: BetaGatePlan,
  runner: BetaCommandRunner,
): Promise<BetaGateResult> {
  const startedAt = new Date().toISOString()
  const result = await runner(gate.command)
  if (result.exitCode !== 0)
    throw new Error(
      `beta smoke failed at ${gate.id} (exit ${result.exitCode}): ${result.stderr}`,
    )
  const evidence = gate.evidence.map((path) => ({
    path,
    sha256: sha256(readFileSync(resolve(path))),
  }))
  return {
    id: gate.id,
    status: 'passed',
    command: gate.command,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: 0,
    outputSha256: sha256(`${result.stdout}\u0000${result.stderr}`),
    evidence,
  }
}

function gateResultPath(releaseSha: string, id: BetaLocalGateId): string {
  return join(fragmentRoot(releaseSha), 'gates', `${id}.json`)
}

function stageGateResult(releaseSha: string, result: BetaGateResult): void {
  stageGateEvidence(releaseSha, result.evidence)
  writeChecksummed(gateResultPath(releaseSha, result.id), canonicalJson(result))
}

function readStagedGateResult(releaseSha: string, gate: BetaGatePlan): BetaGateResult {
  const path = gateResultPath(releaseSha, gate.id)
  const { content } = checksummedContent(path)
  const result = objectValue(JSON.parse(content) as unknown, `staged gate ${gate.id}`)
  if (
    result.id !== gate.id ||
    canonicalJson(result.command) !== canonicalJson(gate.command) ||
    !Array.isArray(result.evidence)
  ) {
    throw new Error(`staged gate ${gate.id} does not match the authoritative plan`)
  }
  const typed = result as unknown as BetaGateResult
  if (typed.status !== 'passed' || typed.exitCode !== 0)
    throw new Error(`staged gate ${gate.id} is not passed`)
  const expectedPaths = gate.evidence
  if (
    JSON.stringify(typed.evidence.map(({ path: evidencePath }) => evidencePath)) !==
    JSON.stringify(expectedPaths)
  )
    throw new Error(`staged gate ${gate.id} evidence paths do not match the plan`)
  materializeGateEvidence(releaseSha, typed.evidence)
  return typed
}

async function observeBetaImages(
  releaseSha: string,
  runner: BetaCommandRunner,
): Promise<void> {
  const tags: Readonly<Record<string, string>> = {
    web: `repkey-local-web:${releaseSha}`,
    worker: `repkey-local-worker:${releaseSha}`,
    provider: `repkey-local-provider:${releaseSha}`,
    perf: `repkey-local-perf:${releaseSha}`,
  }
  const imageIds: Record<string, string> = {}
  for (const name of ['web', 'worker', 'provider', 'perf']) {
    const inspected = await runner({
      executable: 'docker',
      args: ['image', 'inspect', tags[name] ?? '', '--format={{.Id}}'],
    })
    const imageId = inspected.stdout.trim()
    if (inspected.exitCode !== 0 || !/^sha256:[0-9a-f]{64}$/.test(imageId))
      throw new Error(`docker inspect failed for beta image ${name}`)
    imageIds[name] = imageId
  }
  writeChecksummed(
    join(fragmentRoot(releaseSha), 'observations', 'image-identities.json'),
    canonicalJson({
      schemaVersion: 'beta-local-1',
      evidenceKind: 'observed-beta-image-identities',
      sourceRevision: releaseSha,
      imageIds,
    }),
  )
}

function groupMarkerPath(releaseSha: string, group: BetaSmokeScenarioGroup): string {
  return join(fragmentRoot(releaseSha), 'groups', `${group}.json`)
}

function writeGroupMarker(releaseSha: string, group: BetaSmokeScenarioGroup): void {
  const definition = betaSmokeScenarioGroupDefinition(group)
  writeChecksummed(
    groupMarkerPath(releaseSha, group),
    canonicalJson({
      schemaVersion: 'beta-local-1',
      evidenceKind: 'beta-smoke-scenario-group',
      releaseSha,
      group,
      scenarios: definition.scenarios,
      gates: definition.gates,
    }),
  )
}

function requireEveryGroupMarker(releaseSha: string): void {
  for (const group of BETA_SMOKE_SCENARIO_GROUPS) {
    const definition = betaSmokeScenarioGroupDefinition(group)
    const path = groupMarkerPath(releaseSha, group)
    const marker = objectValue(
      JSON.parse(checksummedContent(path).content) as unknown,
      `scenario group ${group}`,
    )
    if (
      marker.releaseSha !== releaseSha ||
      marker.group !== group ||
      JSON.stringify(marker.scenarios) !== JSON.stringify(definition.scenarios) ||
      JSON.stringify(marker.gates) !== JSON.stringify(definition.gates)
    ) {
      throw new Error(`scenario group ${group} marker does not match its plan`)
    }
  }
}

async function runScenarioGroup(
  releaseSha: string,
  group: BetaSmokeScenarioGroup,
  preCutoverDump: string | undefined,
  runner: BetaCommandRunner,
): Promise<void> {
  const workRoot = smokeWorkRoot(releaseSha)
  const fragments = fragmentRoot(releaseSha)
  const marker = groupMarkerPath(releaseSha, group)
  rmSync(workRoot, { recursive: true, force: true })
  // Parallel CI rows have isolated filesystems and the artifact aggregate
  // merges their fragments. Preserve sibling rows here so the same three
  // commands can also run sequentially in one local checkout.
  rmSync(marker, { force: true })
  rmSync(`${marker}.sha256`, { force: true })
  mkdirSync(workRoot, { recursive: true })
  mkdirSync(fragments, { recursive: true })

  const definition = betaSmokeScenarioGroupDefinition(group)
  let dump = preCutoverDump
  if (definition.scenarios.includes('upgrade') && !dump)
    dump = createPreCutoverDump().path
  for (const scenario of definition.scenarios) {
    const result = await runner(createStackScenarioCommand(scenario, dump))
    if (result.exitCode !== 0)
      throw new Error(
        `beta smoke ${scenario} scenario failed (exit ${result.exitCode}): ${result.stderr}`,
      )
    stageScenarioEvidence(releaseSha, scenario)
    if (scenario === 'upgrade') await observeBetaImages(releaseSha, runner)
  }

  // A later clean-start lifecycle deletes the prior lifecycle's directory.
  // Restore this row's staged files before its evidence-verifier gates run.
  for (const scenario of definition.scenarios) {
    copyChecksummed(
      fragmentScenarioPath(releaseSha, scenario),
      scenarioEvidencePath(scenario),
    )
  }

  const plan = createBetaSmokeGatePlan({ releaseSha, sourceRevision: releaseSha })
  for (const id of definition.gates) {
    const gate = plan.find((candidate) => candidate.id === id)
    if (!gate) throw new Error(`scenario group ${group} names unknown gate ${id}`)
    stageGateResult(releaseSha, await executeGate(gate, runner))
  }
  writeGroupMarker(releaseSha, group)
}

function createAcceptanceIndex(releaseSha: string): Record<string, unknown> {
  materializeScenarioEvidence(releaseSha)
  const cleanPath = scenarioEvidencePath('clean-smoke')
  const scalePath = scenarioEvidencePath('scale')
  const faultPath = scenarioEvidencePath('faults')
  const upgradePath = scenarioEvidencePath('upgrade')
  const cleanDigest = checksummedContent(cleanPath).digest
  const scaleDigest = checksummedContent(scalePath).digest
  const faultDigest = checksummedContent(faultPath).digest
  const upgradeDigest = checksummedContent(upgradePath).digest
  const clean = parsedJson(cleanPath, 'clean smoke evidence')
  const scale = parsedJson(scalePath, 'scale evidence')
  const faults = parsedJson(faultPath, 'fault evidence')
  const upgraded = parsedJson(upgradePath, 'upgrade evidence')
  for (const [label, evidence] of Object.entries({ clean, scale, faults, upgraded })) {
    if (evidence.sourceRevision !== releaseSha)
      throw new Error(`${label} evidence source revision does not match release SHA`)
  }

  const acceptance = {
    schemaVersion: 'beta-local-1',
    evidenceKind: 'local-stack-acceptance-index',
    sourceRevision: releaseSha,
    cleanDigest,
    scaleDigest,
    faultDigest,
    upgradeDigest,
    cleanMigrationHead: clean.migrationHead,
    upgradeMigrationHead: upgraded.upgradedHead,
    stackContractSha256: sha256(readFileSync(resolve('compose.local.yml'))),
    scaleFixtureSha256: scale.scaleFixtureFileSha256,
    fleetFixtureSha256: scale.fleetFixtureFileSha256,
    images: upgraded.images,
    claims: ['local-application', 'local-image', 'local-topology'],
    exclusions: ['pitr', 'hosted-capacity', 'managed-region-failover', 'pilot'],
  }
  const path = resolve(STACK_ACCEPTANCE_ROOT, 'acceptance-index.json')
  writeChecksummed(path, `${JSON.stringify(acceptance, null, 2)}\n`)
  return acceptance
}

function deriveBetaSmokeIdentity(
  releaseSha: string,
  acceptance: Record<string, unknown>,
): BetaSmokeIdentity {
  const observationPath = join(
    fragmentRoot(releaseSha),
    'observations',
    'image-identities.json',
  )
  const observation = objectValue(
    JSON.parse(checksummedContent(observationPath).content) as unknown,
    'image identity observation',
  )
  if (observation.sourceRevision !== releaseSha)
    throw new Error(
      'image identity observation source revision does not match release SHA',
    )
  const inspectedImageIds = objectValue(observation.imageIds, 'observed beta image ids')
  const identity = buildBetaSmokeIdentity({
    releaseSha,
    acceptance,
    lockfileContent: readFileSync(resolve('pnpm-lock.yaml')),
    productContractContent: readFileSync(
      resolve('e2e/critical/beta-product-journeys.spec.ts'),
    ),
    inspectedImageIds: Object.fromEntries(
      Object.entries(inspectedImageIds).map(([name, value]) => [name, String(value)]),
    ),
  })
  const acceptancePath = resolve(STACK_ACCEPTANCE_ROOT, 'acceptance-index.json')
  const identityPath = join(smokeWorkRoot(releaseSha), 'identity-observation.json')
  writeChecksummed(
    identityPath,
    canonicalJson({
      schemaVersion: 'beta-local-1',
      evidenceKind: 'observed-beta-smoke-identity',
      identity,
      acceptanceIndexSha256: sha256(readFileSync(acceptancePath)),
    }),
  )
  return identity
}

async function finalizeBetaSmoke(
  releaseSha: string,
  outputRoot: string,
  runner: BetaCommandRunner,
): Promise<void> {
  if (existsSync(join(outputRoot, releaseSha)))
    throw new Error(`release SHA ${releaseSha} already has smoke evidence`)
  requireEveryGroupMarker(releaseSha)
  rmSync(smokeWorkRoot(releaseSha), { recursive: true, force: true })
  rmSync(resolve(STACK_ACCEPTANCE_ROOT), { recursive: true, force: true })
  mkdirSync(smokeWorkRoot(releaseSha), { recursive: true })

  const acceptance = createAcceptanceIndex(releaseSha)
  const identity = deriveBetaSmokeIdentity(releaseSha, acceptance)
  const plan = createBetaSmokeGatePlan(identity)
  const groupGateIds = new Set(
    BETA_SMOKE_SCENARIO_GROUPS.flatMap(
      (group) => betaSmokeScenarioGroupDefinition(group).gates,
    ),
  )
  const gateResults: BetaGateResult[] = []
  for (const gate of plan) {
    gateResults.push(
      groupGateIds.has(gate.id)
        ? readStagedGateResult(releaseSha, gate)
        : await executeGate(gate, runner),
    )
  }
  if (
    JSON.stringify(gateResults.map(({ id }) => id)) !==
    JSON.stringify(REQUIRED_BETA_LOCAL_GATE_IDS)
  ) {
    throw new Error(
      'final beta manifest does not contain the exact required gate sequence',
    )
  }
  const startedAt = gateResults
    .map(({ startedAt: value }) => value)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
  const completedAt = gateResults
    .map(({ completedAt: value }) => value)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  if (!startedAt || !completedAt) throw new Error('beta smoke produced no gate results')
  const manifest: BetaSmokeManifest = {
    version: BETA_LOCAL_EVIDENCE_VERSION,
    identity,
    startedAt,
    completedAt,
    gates: gateResults,
  }
  const persisted = persistBetaSmokeManifest({ outputRoot, manifest })
  console.log(
    `beta smoke passed: ${persisted.manifestPath} (${persisted.manifestSha256})`,
  )
}

export async function runBetaSmokeCli(
  args: readonly string[],
  runner: BetaCommandRunner = spawnBetaCommand,
): Promise<number> {
  try {
    const groupValue = flagValue(args, '--group')
    const finalize = args.includes('--finalize')
    if ((!groupValue && !finalize) || (groupValue !== undefined && finalize)) {
      console.error(
        `Usage: --group=<${BETA_SMOKE_SCENARIO_GROUPS.join('|')}> | --finalize`,
      )
      return 2
    }
    if (
      groupValue !== undefined &&
      !BETA_SMOKE_SCENARIO_GROUPS.includes(groupValue as BetaSmokeScenarioGroup)
    ) {
      console.error(`Unknown beta smoke scenario group: ${groupValue}`)
      return 2
    }
    const releaseSha = await observedReleaseSha(args, runner)
    const preCutoverDump = flagValue(args, '--pre-cutover-dump')
    if (groupValue) {
      await runScenarioGroup(
        releaseSha,
        groupValue as BetaSmokeScenarioGroup,
        preCutoverDump ? resolve(preCutoverDump) : undefined,
        runner,
      )
    } else {
      const outputRoot = resolve(flagValue(args, '--output-root') ?? DEFAULT_OUTPUT_ROOT)
      await finalizeBetaSmoke(releaseSha, outputRoot, runner)
    }
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
