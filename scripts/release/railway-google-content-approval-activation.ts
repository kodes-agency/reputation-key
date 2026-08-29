import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
  CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
} from '../../.railway/service-source-map'
import { getDb, type Database } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import {
  createGoogleContentAuthorityRepository,
  type GoogleContentAuthorityRepository,
} from '../../src/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  canonicalGoogleContentSha256,
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentApprovalBundle,
  parseGoogleContentRolePublicKeys,
  validateGoogleContentApprovalBundle,
  type GoogleContentApprovalBundle,
  type GoogleContentRolePublicKeys,
} from '../../src/shared/auth/google-content-approval'
import {
  GOOGLE_CONTENT_CAPABILITIES,
  type GoogleContentCapability,
} from '../../src/shared/auth/google-content-contract'
import {
  parseGoogleContentRuntimeBindings,
  type GoogleContentRuntimeBindings,
} from '../../src/shared/auth/google-content-runtime-bindings'
import type { GoogleContentRuntimeBinding } from '../../src/shared/auth/google-content-authority'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  assertRailwayFullProjectVisibilityCredential,
  assertSingleUsBetaRailwayFoundationReadback,
  parseRailwayProjectServiceInventory,
  railwayFullProjectStatusArgs,
} from '../../src/shared/release/railway-project-service-isolation'
import { railwayPlanArgs } from '../../src/shared/release/railway-plan-evidence'
import { readOnce } from '../../src/shared/release/read-once'
import { railwayTargetEnvironment } from './railway-data-cell-plan'
import { assertSingleUsBetaRailwayFoundationNoDriftOutput } from './railway-data-cell-foundation'
import {
  MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION,
  assertRailwayCliSupportsPinnedPlans,
} from './staged-railway-sources'

const INTENT_VERSION = 'repkey-google-content-approval-activation-1' as const
const RUNTIME_BINDINGS_VARIABLE = 'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON' as const
const ROLE_PUBLIC_KEYS_VARIABLE = 'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON' as const
const TARGET_VARIABLES = Object.freeze([
  RUNTIME_BINDINGS_VARIABLE,
  ROLE_PUBLIC_KEYS_VARIABLE,
] as const)
const IAC_FILE = '.railway/railway.ts'
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_INPUT_BYTES = 5 * 1024 * 1024
const MAX_INTENT_BYTES = 25 * 1024 * 1024

type JsonRecord = Readonly<Record<string, unknown>>
type ActivationMode = 'plan' | 'apply' | 'recover' | 'verify'

export type RailwayGoogleContentApprovalActivationCommandResult = Readonly<{
  status: number
  stdout: string
  stderr: string
  error?: Error
}>

export type RailwayGoogleContentApprovalActivationExecutor = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  stdin?: string,
) => RailwayGoogleContentApprovalActivationCommandResult

export type GoogleContentApprovalActivationInspection = Readonly<{
  killedCapabilities: readonly GoogleContentCapability[]
  activeWorkCapabilities: readonly GoogleContentCapability[]
  activeCleanupCapabilities: readonly GoogleContentCapability[]
  matchingApprovalCandidateSha256: Readonly<
    Partial<Record<GoogleContentCapability, string>>
  >
}>

export type GoogleContentApprovalActivationDatabase = Readonly<{
  inspect(
    runtimeBindings: GoogleContentRuntimeBindings,
  ): Promise<GoogleContentApprovalActivationInspection>
  ensureApproval(
    bundle: GoogleContentApprovalBundle,
  ): Promise<Readonly<{ approvalBindingId: string; inserted: boolean }>>
}>

export type GoogleContentApprovalActivationMutationRunner = (
  input: Readonly<{ operator: string; reason: string; ticket: string }>,
  action: () => Promise<void>,
) => Promise<number>

type ActivationOptions = Readonly<{
  mode: ActivationMode
  projectId: string
  environmentId: string
  intentPath: string
  intentSha256?: string
  ticket?: string
  publicKeysPath?: string
  bundlePaths: readonly string[]
  operator?: string
  reason?: string
}>

type IntentBundle = Readonly<{
  fileSha256: string
  candidateSha256: string
  bundle: GoogleContentApprovalBundle
}>

type ActivationIntent = Readonly<{
  version: typeof INTENT_VERSION
  ticket: string
  deploymentProfile: 'production'
  cell: 'us'
  project: Readonly<{
    id: string
    name: typeof PRODUCTION_RAILWAY_PROJECT_NAME
  }>
  environment: Readonly<{ id: string; name: 'cell-us' }>
  rolePublicKeys: GoogleContentRolePublicKeys
  runtimeBindings: GoogleContentRuntimeBindings
  bundles: readonly IntentBundle[]
  baseline: Readonly<{
    configurationSha256: string
    expectedConfigurationSha256: string
    unrelatedConfigurationSha256: string
  }>
}>

type ParsedIntent = Readonly<{
  intent: ActivationIntent
  bytes: Buffer
  sha256: string
  expectedVariableValues: Readonly<Record<(typeof TARGET_VARIABLES)[number], string>>
}>

type ActivationDependencies = Readonly<{
  railway?: RailwayGoogleContentApprovalActivationExecutor
  database?: GoogleContentApprovalActivationDatabase
  clock?: () => Date
  runMutation?: GoogleContentApprovalActivationMutationRunner
}>

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function nonEmptyString(value: unknown, label: string, max = 255): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

function flagValues(args: readonly string[], name: string): readonly string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value?.startsWith(`${name}=`)) {
      values.push(value.slice(name.length + 1))
    } else if (value === name) {
      const next = args[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${name} requires a value`)
      values.push(next)
      index += 1
    }
  }
  return Object.freeze(values)
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const values = flagValues(args, name)
  if (values.length > 1) throw new Error(`${name} must be provided exactly once`)
  return values[0]
}

function requiredFlag(args: readonly string[], name: string): string {
  return nonEmptyString(flagValue(args, name), name)
}

function parseOptions(args: readonly string[]): ActivationOptions {
  const mode = args[0]
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'recover' && mode !== 'verify') {
    throw new Error('first argument must be plan, apply, recover, or verify')
  }
  if (flagValue(args, '--cell') !== 'us') throw new Error('--cell must be us')
  if (flagValue(args, '--deployment-profile') !== 'production') {
    throw new Error('--deployment-profile must be production')
  }
  const intentSha256 = flagValue(args, '--intent-sha256')
  if (mode !== 'plan' && (!intentSha256 || !SHA256.test(intentSha256))) {
    throw new Error('--intent-sha256 must be the reviewed lowercase sha256')
  }
  const bundlePaths = flagValues(args, '--bundle').map((path) => resolve(path))
  if (mode === 'plan' && bundlePaths.length !== GOOGLE_CONTENT_CAPABILITIES.length) {
    throw new Error(
      `plan requires exactly ${String(GOOGLE_CONTENT_CAPABILITIES.length)} --bundle inputs`,
    )
  }
  if (mode !== 'plan' && bundlePaths.length !== 0) {
    throw new Error('--bundle is accepted only while creating the canonical intent')
  }
  const publicKeys = flagValue(args, '--public-keys')
  if (mode === 'plan' && !publicKeys) throw new Error('--public-keys is required')
  if (mode !== 'plan' && publicKeys) {
    throw new Error('--public-keys is accepted only while creating the canonical intent')
  }
  const ticket = flagValue(args, '--ticket')
  if (mode === 'plan' && !ticket) throw new Error('--ticket is required')
  return Object.freeze({
    mode,
    projectId: requiredFlag(args, '--project-id'),
    environmentId: requiredFlag(args, '--environment-id'),
    intentPath: resolve(requiredFlag(args, '--intent')),
    bundlePaths: Object.freeze(bundlePaths),
    ...(intentSha256 ? { intentSha256 } : {}),
    ...(ticket ? { ticket: nonEmptyString(ticket, '--ticket') } : {}),
    ...(publicKeys ? { publicKeysPath: resolve(publicKeys) } : {}),
    ...(flagValue(args, '--operator')
      ? { operator: nonEmptyString(flagValue(args, '--operator'), '--operator') }
      : {}),
    ...(flagValue(args, '--reason')
      ? { reason: nonEmptyString(flagValue(args, '--reason'), '--reason', 500) }
      : {}),
  })
}

function defaultRailwayExecutor(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  stdin?: string,
): RailwayGoogleContentApprovalActivationCommandResult {
  const result = spawnSync('railway', [...args], {
    encoding: 'utf8',
    env: environment,
    ...(stdin === undefined ? {} : { input: stdin }),
    maxBuffer: MAX_INTENT_BYTES,
  })
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  })
}

function railwayCommand(
  railway: RailwayGoogleContentApprovalActivationExecutor,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  stdin?: string,
): RailwayGoogleContentApprovalActivationCommandResult {
  const result = railway(args, environment, stdin)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `railway ${args.join(' ')} exited ${String(result.status)}`,
    )
  }
  return result
}

function assertExactRailwayCliVersion(output: string): void {
  assertRailwayCliSupportsPinnedPlans(output)
  const observed = /\b(\d+\.\d+\.\d+)\b/u.exec(output)?.[1]
  if (observed !== MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION) {
    throw new Error(
      `Google Content activation is pinned to Railway CLI ${MINIMUM_PINNED_PLAN_RAILWAY_CLI_VERSION}; observed ${observed ?? 'unknown'}`,
    )
  }
}

// These bytes decide everything downstream: the bundle and intent readers hash
// them against a digest the operator reviewed, and the public-keys reader hands
// them to the role signature verifier. Reading them through one path resolution
// makes the inode that passed the bounded-regular-file guard the inode whose
// bytes are used. `readOnce` documents what this does and does not contain.
//
// The `byteLength` re-check stays because the size bound is the one thing the
// descriptor does not pin: the same inode can be appended to between the
// descriptor `fstat` and the read.
function readRegularFile(path: string, maxBytes: number, label: string): Buffer {
  const bytes = readOnce(path, `${label} must be a bounded regular file`, maxBytes)
  if (bytes.byteLength > maxBytes) throw new Error(`${label} is too large`)
  return bytes
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Railway configuration is not finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value !== 'object') {
    throw new Error('Railway configuration is not JSON-compatible')
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(Reflect.get(value, key))}`)
    .join(',')}}`
}

function jsonSha256(value: unknown): string {
  return sha256Bytes(stableJson(value))
}

function runtimeBindingFromBundle(
  bundle: GoogleContentApprovalBundle,
): GoogleContentRuntimeBinding {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = bundle.candidate.binding
  return Object.freeze(runtime)
}

function completeRuntimeBindings(
  bundles: readonly GoogleContentApprovalBundle[],
): GoogleContentRuntimeBindings {
  const entries = bundles.map(
    (bundle) =>
      [bundle.candidate.binding.capability, runtimeBindingFromBundle(bundle)] as const,
  )
  const capabilities = entries.map(([capability]) => capability)
  if (
    new Set(capabilities).size !== GOOGLE_CONTENT_CAPABILITIES.length ||
    GOOGLE_CONTENT_CAPABILITIES.some((capability) => !capabilities.includes(capability))
  ) {
    throw new Error('activation intent requires exactly one bundle per capability')
  }
  return Object.freeze(Object.fromEntries(entries)) as GoogleContentRuntimeBindings
}

function assertCompleteRuntimeBindings(bindings: GoogleContentRuntimeBindings): void {
  const keys = Object.keys(bindings)
  if (
    keys.length !== GOOGLE_CONTENT_CAPABILITIES.length ||
    GOOGLE_CONTENT_CAPABILITIES.some((capability) => !bindings[capability])
  ) {
    throw new Error('runtime binding map must contain all four Google capabilities')
  }
}

function commonBindingFingerprint(bundle: GoogleContentApprovalBundle): string {
  const {
    capability: _capability,
    evidenceManifestSha256: _manifest,
    evidenceIndexSha256: _index,
    ...common
  } = bundle.candidate.binding
  return canonicalGoogleContentSha256(common)
}

function validateBundleSet(
  bundles: readonly GoogleContentApprovalBundle[],
  publicKeys: GoogleContentRolePublicKeys,
  now: Date,
): GoogleContentRuntimeBindings {
  if (bundles.length !== GOOGLE_CONTENT_CAPABILITIES.length) {
    throw new Error('activation intent requires all four Google Content bundles')
  }
  const verify = createGoogleContentRoleSignatureVerifier(publicKeys)
  for (const bundle of bundles) {
    const validation = validateGoogleContentApprovalBundle(bundle, now, verify)
    if (!validation.ok) {
      throw new Error(
        `Google Content bundle for ${bundle.candidate.binding.capability} was refused: ${validation.code}`,
      )
    }
    if (
      validation.binding.targetPhase !== 'railway_closed_beta' ||
      validation.binding.environmentProfile !== 'railway-closed-beta-1'
    ) {
      throw new Error('activation accepts only railway_closed_beta approvals')
    }
  }
  const commonFingerprints = new Set(bundles.map(commonBindingFingerprint))
  if (commonFingerprints.size !== 1) {
    throw new Error('all four approval bundles must bind one exact deployment')
  }
  const owners = new Set(
    bundles.flatMap((bundle) =>
      bundle.candidate.roleDocuments.map(({ document }) => document.approverIdentity),
    ),
  )
  if (owners.size !== 1) {
    throw new Error('all four approval bundles must use one accountable owner')
  }
  const bindings = completeRuntimeBindings(bundles)
  assertCompleteRuntimeBindings(bindings)
  return bindings
}

function parseInputBundle(path: string): IntentBundle {
  const bytes = readRegularFile(path, MAX_INPUT_BYTES, 'Google Content bundle')
  const parsed = parseGoogleContentApprovalBundle(
    parseJsonBytes(bytes, 'Google Content bundle'),
  )
  if (!parsed.ok) throw new Error('Google Content bundle is invalid')
  return Object.freeze({
    fileSha256: sha256Bytes(bytes),
    candidateSha256: canonicalGoogleContentSha256(parsed.bundle.candidate),
    bundle: parsed.bundle,
  })
}

function parseInputPublicKeys(path: string): GoogleContentRolePublicKeys {
  const bytes = readRegularFile(path, MAX_INPUT_BYTES, 'Google Content public keys')
  const parsed = parseGoogleContentRolePublicKeys(
    parseJsonBytes(bytes, 'Google Content public keys'),
  )
  if (!parsed.ok) throw new Error('Google Content public keys are invalid')
  return parsed.publicKeys
}

function expectedVariableValues(
  intent: Pick<ActivationIntent, 'runtimeBindings' | 'rolePublicKeys'>,
): Readonly<Record<(typeof TARGET_VARIABLES)[number], string>> {
  return Object.freeze({
    [RUNTIME_BINDINGS_VARIABLE]: JSON.stringify(intent.runtimeBindings),
    [ROLE_PUBLIC_KEYS_VARIABLE]: JSON.stringify(intent.rolePublicKeys),
  })
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function variableRecord(
  sharedVariables: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = sharedVariables[key]
  if (value === undefined || value === null) return {}
  return { ...record(value, `Railway shared variable ${key}`) }
}

function expectedConfiguration(
  baseline: JsonRecord,
  targetValues: Readonly<Record<(typeof TARGET_VARIABLES)[number], string>>,
): JsonRecord {
  const expected = cloneJson(baseline) as Record<string, unknown>
  const shared = record(
    expected.sharedVariables,
    'Railway environment config sharedVariables',
  ) as Record<string, unknown>
  for (const key of TARGET_VARIABLES) {
    shared[key] = { ...variableRecord(shared, key), value: targetValues[key] }
  }
  return expected
}

function unrelatedConfiguration(config: JsonRecord): JsonRecord {
  const unrelated = cloneJson(config) as Record<string, unknown>
  const shared = record(
    unrelated.sharedVariables,
    'Railway environment config sharedVariables',
  ) as Record<string, unknown>
  for (const key of TARGET_VARIABLES) delete shared[key]
  return unrelated
}

function currentVariableValue(config: JsonRecord, key: string): string | undefined {
  const shared = record(
    config.sharedVariables,
    'Railway environment config sharedVariables',
  )
  const entry = shared[key]
  if (entry === undefined || entry === null) return undefined
  const value = record(entry, `Railway shared variable ${key}`).value
  if (typeof value !== 'string') {
    throw new Error(`Railway shared variable ${key} does not expose an exact value`)
  }
  return value
}

function assertSafeKeyRotation(
  config: JsonRecord,
  targetBindings: GoogleContentRuntimeBindings,
  targetPublicKeys: GoogleContentRolePublicKeys,
): void {
  const currentBindingsRaw = currentVariableValue(config, RUNTIME_BINDINGS_VARIABLE)
  const currentKeysRaw = currentVariableValue(config, ROLE_PUBLIC_KEYS_VARIABLE)
  if ((currentBindingsRaw === undefined) !== (currentKeysRaw === undefined)) {
    throw new Error('current Google Content shared variables are only partially defined')
  }
  if (!currentBindingsRaw || !currentKeysRaw) return
  const currentBindings = parseGoogleContentRuntimeBindings(currentBindingsRaw)
  assertCompleteRuntimeBindings(currentBindings)
  let currentKeysInput: unknown
  try {
    currentKeysInput = JSON.parse(currentKeysRaw)
  } catch {
    throw new Error('current Google Content public keys are invalid')
  }
  const currentKeys = parseGoogleContentRolePublicKeys(currentKeysInput)
  if (!currentKeys.ok) throw new Error('current Google Content public keys are invalid')
  if (jsonSha256(currentKeys.publicKeys) === jsonSha256(targetPublicKeys)) return
  for (const capability of GOOGLE_CONTENT_CAPABILITIES) {
    if (
      jsonSha256(currentBindings[capability]) === jsonSha256(targetBindings[capability])
    ) {
      throw new Error(
        `role-key rotation requires a distinct runtime binding for ${capability}`,
      )
    }
  }
}

function parseRailwayEnvironmentConfig(output: string): JsonRecord {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway environment config is not valid JSON')
  }
  const config = record(value, 'Railway environment config')
  record(config.sharedVariables, 'Railway environment config sharedVariables')
  return config
}

function intentBytes(intent: ActivationIntent): Buffer {
  return Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, 'utf8')
}

function parseIntent(path: string, now: Date): ParsedIntent {
  const bytes = readRegularFile(path, MAX_INTENT_BYTES, 'activation intent')
  const root = record(parseJsonBytes(bytes, 'activation intent'), 'activation intent')
  exactKeys(
    root,
    [
      'version',
      'ticket',
      'deploymentProfile',
      'cell',
      'project',
      'environment',
      'rolePublicKeys',
      'runtimeBindings',
      'bundles',
      'baseline',
    ],
    'activation intent',
  )
  if (
    root.version !== INTENT_VERSION ||
    root.deploymentProfile !== 'production' ||
    root.cell !== 'us'
  ) {
    throw new Error('activation intent has the wrong contract version or target')
  }
  const project = record(root.project, 'activation intent project')
  exactKeys(project, ['id', 'name'], 'activation intent project')
  const environment = record(root.environment, 'activation intent environment')
  exactKeys(environment, ['id', 'name'], 'activation intent environment')
  if (
    project.name !== PRODUCTION_RAILWAY_PROJECT_NAME ||
    environment.name !== 'cell-us'
  ) {
    throw new Error('activation intent does not target production cell-us')
  }
  const publicKeys = parseGoogleContentRolePublicKeys(root.rolePublicKeys)
  if (!publicKeys.ok) throw new Error('activation intent public keys are invalid')
  const bundleValues = root.bundles
  if (!Array.isArray(bundleValues))
    throw new Error('activation intent bundles are invalid')
  const bundles = bundleValues.map((value, index) => {
    const entry = record(value, `activation intent bundle[${String(index)}]`)
    exactKeys(
      entry,
      ['fileSha256', 'candidateSha256', 'bundle'],
      `activation intent bundle[${String(index)}]`,
    )
    const parsed = parseGoogleContentApprovalBundle(entry.bundle)
    if (
      !parsed.ok ||
      typeof entry.fileSha256 !== 'string' ||
      !SHA256.test(entry.fileSha256) ||
      typeof entry.candidateSha256 !== 'string' ||
      !SHA256.test(entry.candidateSha256) ||
      canonicalGoogleContentSha256(parsed.bundle.candidate) !== entry.candidateSha256
    ) {
      throw new Error(`activation intent bundle[${String(index)}] is invalid`)
    }
    return Object.freeze({
      fileSha256: entry.fileSha256,
      candidateSha256: entry.candidateSha256,
      bundle: parsed.bundle,
    })
  })
  const runtimeBindings = validateBundleSet(
    bundles.map(({ bundle }) => bundle),
    publicKeys.publicKeys,
    now,
  )
  if (!isDeepStrictEqual(root.runtimeBindings, runtimeBindings)) {
    throw new Error('activation intent runtime bindings do not match its bundles')
  }
  const baseline = record(root.baseline, 'activation intent baseline')
  exactKeys(
    baseline,
    [
      'configurationSha256',
      'expectedConfigurationSha256',
      'unrelatedConfigurationSha256',
    ],
    'activation intent baseline',
  )
  for (const [key, value] of Object.entries(baseline)) {
    if (typeof value !== 'string' || !SHA256.test(value)) {
      throw new Error(`activation intent baseline.${key} is invalid`)
    }
  }
  const intent: ActivationIntent = Object.freeze({
    version: INTENT_VERSION,
    ticket: nonEmptyString(root.ticket, 'activation intent ticket'),
    deploymentProfile: 'production',
    cell: 'us',
    project: Object.freeze({
      id: nonEmptyString(project.id, 'activation intent project.id'),
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
    }),
    environment: Object.freeze({
      id: nonEmptyString(environment.id, 'activation intent environment.id'),
      name: 'cell-us',
    }),
    rolePublicKeys: publicKeys.publicKeys,
    runtimeBindings,
    bundles: Object.freeze(bundles),
    baseline: Object.freeze({
      configurationSha256: String(baseline.configurationSha256),
      expectedConfigurationSha256: String(baseline.expectedConfigurationSha256),
      unrelatedConfigurationSha256: String(baseline.unrelatedConfigurationSha256),
    }),
  })
  return Object.freeze({
    intent,
    bytes,
    sha256: sha256Bytes(bytes),
    expectedVariableValues: expectedVariableValues(intent),
  })
}

function railwayEnvironment(options: ActivationOptions): NodeJS.ProcessEnv {
  return {
    ...railwayTargetEnvironment({
      project: options.projectId,
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
      environment: options.environmentId,
    }),
    RAILWAY_CALLER:
      process.env.RAILWAY_CALLER ?? 'repo:railway-google-content-approval-activation',
    RAILWAY_AGENT_SESSION:
      process.env.RAILWAY_AGENT_SESSION ?? 'repkey-production-us-google-approval',
    REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
    REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
    [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  }
}

function assertRailwayTarget(
  railway: RailwayGoogleContentApprovalActivationExecutor,
  options: ActivationOptions,
  environment: NodeJS.ProcessEnv,
): JsonRecord {
  const status = railwayCommand(railway, railwayFullProjectStatusArgs(), environment)
  assertSingleUsBetaRailwayFoundationReadback(
    parseRailwayProjectServiceInventory(status.stdout),
    {
      projectId: options.projectId,
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      environmentId: options.environmentId,
      environmentName: 'cell-us',
    },
  )
  const noDrift = railwayCommand(
    railway,
    railwayPlanArgs({ iacFile: IAC_FILE }),
    environment,
  )
  assertSingleUsBetaRailwayFoundationNoDriftOutput(noDrift.stdout, {
    deploymentProfile: 'production',
    projectId: options.projectId,
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    environmentId: options.environmentId,
    environmentName: 'cell-us',
  })
  return parseRailwayEnvironmentConfig(
    railwayCommand(
      railway,
      ['environment', 'config', '--environment', options.environmentId, '--json'],
      environment,
    ).stdout,
  )
}

function expectedCandidateDigests(
  intent: ActivationIntent,
): Readonly<Record<GoogleContentCapability, string>> {
  return Object.freeze(
    Object.fromEntries(
      intent.bundles.map(({ candidateSha256, bundle }) => [
        bundle.candidate.binding.capability,
        candidateSha256,
      ]),
    ) as Record<GoogleContentCapability, string>,
  )
}

function assertDatabaseSafe(
  inspection: GoogleContentApprovalActivationInspection,
  intent: ActivationIntent,
  requireInstalled: boolean,
): void {
  const killed = new Set(inspection.killedCapabilities)
  if (GOOGLE_CONTENT_CAPABILITIES.some((capability) => !killed.has(capability))) {
    throw new Error('all four Google Content capabilities must be killed')
  }
  if (
    inspection.activeWorkCapabilities.length !== 0 ||
    inspection.activeCleanupCapabilities.length !== 0
  ) {
    throw new Error('Google Content approval activation requires a complete drain')
  }
  const expected = expectedCandidateDigests(intent)
  for (const capability of GOOGLE_CONTENT_CAPABILITIES) {
    const observed = inspection.matchingApprovalCandidateSha256[capability]
    if (observed !== undefined && observed !== expected[capability]) {
      throw new Error(`conflicting retained approval for ${capability}`)
    }
    if (requireInstalled && observed !== expected[capability]) {
      throw new Error(`reviewed approval is not installed for ${capability}`)
    }
  }
}

function assertLiveConfigurationState(
  live: JsonRecord,
  parsed: ParsedIntent,
): 'baseline' | 'target' {
  const fingerprint = jsonSha256(live)
  if (fingerprint === parsed.intent.baseline.configurationSha256) return 'baseline'
  if (fingerprint === parsed.intent.baseline.expectedConfigurationSha256) {
    for (const key of TARGET_VARIABLES) {
      if (currentVariableValue(live, key) !== parsed.expectedVariableValues[key]) {
        throw new Error(`Railway target value ${key} does not match the intent`)
      }
    }
    if (
      jsonSha256(unrelatedConfiguration(live)) !==
      parsed.intent.baseline.unrelatedConfigurationSha256
    ) {
      throw new Error('unrelated Railway configuration changed')
    }
    return 'target'
  }
  throw new Error('Railway environment configuration drifted after intent review')
}

function assertEnvironmentEditOutput(
  output: string,
  options: ActivationOptions,
  ticket: string,
): void {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error('Railway environment edit output is not valid JSON')
  }
  const result = record(value, 'Railway environment edit output')
  if (
    result.staged !== true ||
    result.committed !== true ||
    result.environmentId !== options.environmentId ||
    result.environmentName !== 'cell-us' ||
    result.message !== ticket
  ) {
    throw new Error('Railway environment edit did not commit to exact cell-us')
  }
}

function environmentPatch(
  values: Readonly<Record<(typeof TARGET_VARIABLES)[number], string>>,
): string {
  return JSON.stringify({
    sharedVariables: {
      [RUNTIME_BINDINGS_VARIABLE]: { value: values[RUNTIME_BINDINGS_VARIABLE] },
      [ROLE_PUBLIC_KEYS_VARIABLE]: { value: values[ROLE_PUBLIC_KEYS_VARIABLE] },
    },
  })
}

function createDefaultDatabase(): GoogleContentApprovalActivationDatabase {
  const repository: GoogleContentAuthorityRepository =
    createGoogleContentAuthorityRepository(getDb())
  return Object.freeze({
    inspect: (runtimeBindings) =>
      repository.transaction(async (tx) => {
        const control = await repository.loadControl(tx)
        const [approvalEntries, activeWorkEntries, activeCleanupEntries] =
          await Promise.all([
            Promise.all(
              GOOGLE_CONTENT_CAPABILITIES.map(async (capability) => {
                const binding = runtimeBindings[capability]
                if (!binding) throw new Error(`runtime binding missing ${capability}`)
                const approval = await repository.loadApprovalForRuntime(tx, binding)
                return [
                  capability,
                  approval ? canonicalGoogleContentSha256(approval.candidate) : undefined,
                ] as const
              }),
            ),
            Promise.all(
              GOOGLE_CONTENT_CAPABILITIES.map(
                async (capability) =>
                  [
                    capability,
                    await repository.hasActiveCapabilityWork(tx, capability),
                  ] as const,
              ),
            ),
            Promise.all(
              GOOGLE_CONTENT_CAPABILITIES.map(
                async (capability) =>
                  [
                    capability,
                    await repository.hasActiveCleanupWork(tx, capability),
                  ] as const,
              ),
            ),
          ])
        return Object.freeze({
          killedCapabilities: control.killedCapabilities,
          activeWorkCapabilities: activeWorkEntries
            .filter(([, active]) => active)
            .map(([capability]) => capability),
          activeCleanupCapabilities: activeCleanupEntries
            .filter(([, active]) => active)
            .map(([capability]) => capability),
          matchingApprovalCandidateSha256: Object.freeze(
            Object.fromEntries(approvalEntries.filter((entry) => entry[1] !== undefined)),
          ),
        })
      }),
    ensureApproval: (bundle) =>
      repository.transaction(async (tx: Database) => {
        const ensured = await repository.ensureApproval(tx, bundle.candidate)
        return Object.freeze({
          approvalBindingId: ensured.record.id,
          inserted: ensured.inserted,
        })
      }),
  })
}

async function defaultMutationRunner(
  input: Readonly<{ operator: string; reason: string; ticket: string }>,
  action: () => Promise<void>,
): Promise<number> {
  const { runOperatorCommand } = await import('../ops/operator-command')
  const result = await runOperatorCommand(
    {
      name: 'infra:railway:google-content-approval',
      scope: 'global',
      mutation: true,
      requiresTicket: true,
      usage:
        'pnpm infra:railway:google-content-approval apply|recover --cell us --deployment-profile production --project-id <id> --environment-id <id> --intent <private-intent.json> --intent-sha256 <sha256> --operator <id> --reason <text> --ticket <ref>',
    },
    async (context) => {
      if (context.dryRun) throw new Error('activation mutation requires apply mode')
      await action()
    },
    [
      '--apply',
      '--operator',
      input.operator,
      '--reason',
      input.reason,
      '--ticket',
      input.ticket,
    ],
  )
  return result.exitCode
}

async function performActivation(
  options: ActivationOptions,
  parsed: ParsedIntent,
  railway: RailwayGoogleContentApprovalActivationExecutor,
  database: GoogleContentApprovalActivationDatabase,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  let live = assertRailwayTarget(railway, options, environment)
  assertLiveConfigurationState(live, parsed)
  let inspection = await database.inspect(parsed.intent.runtimeBindings)
  assertDatabaseSafe(inspection, parsed.intent, false)
  const expectedDigests = expectedCandidateDigests(parsed.intent)

  for (const capability of GOOGLE_CONTENT_CAPABILITIES) {
    if (
      inspection.matchingApprovalCandidateSha256[capability] ===
      expectedDigests[capability]
    ) {
      continue
    }
    const entry = parsed.intent.bundles.find(
      ({ bundle }) => bundle.candidate.binding.capability === capability,
    )
    if (!entry) throw new Error(`intent omitted ${capability}`)
    await database.ensureApproval(entry.bundle)
  }

  inspection = await database.inspect(parsed.intent.runtimeBindings)
  assertDatabaseSafe(inspection, parsed.intent, true)

  // Re-prove the sole exact project and compare the complete configuration
  // immediately before the only Railway mutation. If the prior commit was
  // ambiguous, this read classifies it as baseline or already-target.
  live = assertRailwayTarget(railway, options, environment)
  const state = assertLiveConfigurationState(live, parsed)
  if (state === 'baseline') {
    const edited = railwayCommand(
      railway,
      [
        'environment',
        'edit',
        '--project',
        options.projectId,
        '--environment',
        options.environmentId,
        '--message',
        parsed.intent.ticket,
        '--json',
      ],
      environment,
      environmentPatch(parsed.expectedVariableValues),
    )
    assertEnvironmentEditOutput(edited.stdout, options, parsed.intent.ticket)
  }

  // Settle against a fresh full-project identity, source-less foundation, and
  // no-drift proof rather than trusting the mutation acknowledgement alone.
  live = assertRailwayTarget(railway, options, environment)
  if (assertLiveConfigurationState(live, parsed) !== 'target') {
    throw new Error('Railway Google Content configuration was not activated')
  }
  inspection = await database.inspect(parsed.intent.runtimeBindings)
  assertDatabaseSafe(inspection, parsed.intent, true)
}

export async function runRailwayGoogleContentApprovalActivationCli(
  args: readonly string[],
  dependencies: ActivationDependencies = {},
): Promise<number> {
  let ownsDatabase = false
  try {
    const options = parseOptions(args)
    const railway = dependencies.railway ?? defaultRailwayExecutor
    const clock = dependencies.clock ?? (() => new Date())
    const environment = railwayEnvironment(options)
    assertRailwayFullProjectVisibilityCredential(environment)
    const version = railwayCommand(railway, ['--version'], environment)
    assertExactRailwayCliVersion(`${version.stdout}\n${version.stderr}`)

    const database = dependencies.database ?? createDefaultDatabase()
    ownsDatabase = dependencies.database === undefined

    if (options.mode === 'plan') {
      const publicKeys = parseInputPublicKeys(options.publicKeysPath!)
      const bundleEntries = options.bundlePaths
        .map(parseInputBundle)
        .sort(
          (left, right) =>
            GOOGLE_CONTENT_CAPABILITIES.indexOf(
              left.bundle.candidate.binding.capability,
            ) -
            GOOGLE_CONTENT_CAPABILITIES.indexOf(
              right.bundle.candidate.binding.capability,
            ),
        )
      const runtimeBindings = validateBundleSet(
        bundleEntries.map(({ bundle }) => bundle),
        publicKeys,
        clock(),
      )
      const live = assertRailwayTarget(railway, options, environment)
      assertSafeKeyRotation(live, runtimeBindings, publicKeys)
      const targetValues = expectedVariableValues({
        runtimeBindings,
        rolePublicKeys: publicKeys,
      })
      const expected = expectedConfiguration(live, targetValues)
      const intent: ActivationIntent = Object.freeze({
        version: INTENT_VERSION,
        ticket: options.ticket!,
        deploymentProfile: 'production',
        cell: 'us',
        project: Object.freeze({
          id: options.projectId,
          name: PRODUCTION_RAILWAY_PROJECT_NAME,
        }),
        environment: Object.freeze({ id: options.environmentId, name: 'cell-us' }),
        rolePublicKeys: publicKeys,
        runtimeBindings,
        bundles: Object.freeze(bundleEntries),
        baseline: Object.freeze({
          configurationSha256: jsonSha256(live),
          expectedConfigurationSha256: jsonSha256(expected),
          unrelatedConfigurationSha256: jsonSha256(unrelatedConfiguration(live)),
        }),
      })
      const inspection = await database.inspect(runtimeBindings)
      assertDatabaseSafe(inspection, intent, false)
      const bytes = intentBytes(intent)
      // The exclusive create IS the refusal. `wx` fails with EEXIST atomically,
      // so an existsSync pre-check would only add a window in which the path
      // can appear between the check and the write. Translating EEXIST here
      // keeps the same operator-facing message with one syscall and no window.
      // `src/shared/release/write-once.ts` cannot carry the 0o600 mode, and the
      // private intent must never exist group- or world-readable, so the mode
      // has to be set by the same call that creates the file.
      try {
        writeFileSync(options.intentPath, bytes, { mode: 0o600, flag: 'wx' })
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 'EEXIST') throw error
        throw new Error('activation intent path already exists', { cause: error })
      }
      process.stdout.write(
        `${JSON.stringify({
          intentPath: options.intentPath,
          sha256: sha256Bytes(bytes),
          projectId: options.projectId,
          environmentId: options.environmentId,
          capabilities: GOOGLE_CONTENT_CAPABILITIES,
        })}\n`,
      )
      process.stderr.write(
        `Google Content activation intent retained at ${options.intentPath}; sha256=${sha256Bytes(bytes)}. Review the private all-capability intent before apply.\n`,
      )
      return 0
    }

    const parsed = parseIntent(options.intentPath, clock())
    if (parsed.sha256 !== options.intentSha256) {
      throw new Error('activation intent changed after review')
    }
    if (
      parsed.intent.project.id !== options.projectId ||
      parsed.intent.environment.id !== options.environmentId
    ) {
      throw new Error('activation intent does not target the reviewed IDs')
    }
    if (options.ticket && options.ticket !== parsed.intent.ticket) {
      throw new Error('--ticket does not match the reviewed activation intent')
    }

    if (options.mode === 'verify') {
      const live = assertRailwayTarget(railway, options, environment)
      if (assertLiveConfigurationState(live, parsed) !== 'target') {
        throw new Error('Railway Google Content configuration is not active')
      }
      const inspection = await database.inspect(parsed.intent.runtimeBindings)
      assertDatabaseSafe(inspection, parsed.intent, true)
      process.stderr.write(
        'Verified all four exact retained approvals and the two reviewed cell-us shared values; unrelated Railway configuration is unchanged.\n',
      )
      return 0
    }

    const mutation = dependencies.runMutation ?? defaultMutationRunner
    const operator = nonEmptyString(options.operator, '--operator')
    const reason = nonEmptyString(options.reason, '--reason', 500)
    const ticket = nonEmptyString(options.ticket, '--ticket')
    if (ticket !== parsed.intent.ticket) {
      throw new Error('--ticket does not match the reviewed activation intent')
    }
    const exitCode = await mutation({ operator, reason, ticket }, () =>
      performActivation(options, parsed, railway, database, environment),
    )
    if (exitCode === 0) {
      process.stderr.write(
        `${options.mode === 'recover' ? 'Recovered' : 'Applied'} the reviewed Google Content approval activation for production/cell-us. The signed release controller remains the only authority that may start web or worker sources.\n`,
      )
    }
    return exitCode
  } catch (error) {
    process.stderr.write(
      `Railway Google Content approval activation refused: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  } finally {
    if (ownsDatabase) await closePool()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRailwayGoogleContentApprovalActivationCli(
    process.argv.slice(2),
  )
}
