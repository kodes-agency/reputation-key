import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  BETA_LOCAL_EVIDENCE_VERSION,
  REQUIRED_APPROVAL_ROLES,
  REQUIRED_BETA_LOCAL_GATE_IDS,
} from './release-bundle'

export const BETA_LOCAL_APPROVAL_VERSION = 'beta-local-approval-1' as const
export const BETA_LOCAL_INDEX_VERSION = 'beta-local-index-1' as const

export type BetaLocalGateId = (typeof REQUIRED_BETA_LOCAL_GATE_IDS)[number]
export type BetaLocalApprovalRole = (typeof REQUIRED_APPROVAL_ROLES)[number]

export type BetaSmokeIdentity = Readonly<{
  releaseSha: string
  sourceRevision: string
  lockfileRevision: string
  cleanMigrationHead: string
  upgradeMigrationHead: string
  capabilityPolicyVersion: string
  productHash: string
  stackContractHash: string
  scaleHash: string
  fleetHash: string
  imageDigests: Readonly<Record<string, string>>
}>

export type BetaGateCommand = Readonly<{
  executable: string
  args: readonly string[]
}>

export type BetaGatePlan = Readonly<{
  id: BetaLocalGateId
  command: BetaGateCommand
  evidence: readonly string[]
}>

export type BetaCommandResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>

export type BetaCommandRunner = (
  command: BetaGateCommand,
  options?: Readonly<{ env?: NodeJS.ProcessEnv }>,
) => Promise<BetaCommandResult>
export type BetaGateEvidence = Readonly<{
  path: string
  sha256: string
}>

export type BetaGateResult = Readonly<{
  id: BetaLocalGateId
  status: 'passed'
  command: BetaGateCommand
  startedAt: string
  completedAt: string
  exitCode: 0
  outputSha256: string
  evidence: readonly BetaGateEvidence[]
}>

export type BetaSmokeManifest = Readonly<{
  version: typeof BETA_LOCAL_EVIDENCE_VERSION
  identity: BetaSmokeIdentity
  startedAt: string
  completedAt: string
  gates: readonly BetaGateResult[]
}>

export type BetaSmokeExecution =
  | Readonly<{ ok: true; manifest: BetaSmokeManifest }>
  | Readonly<{
      ok: false
      failedGate: BetaLocalGateId
      exitCode: number
      stderr: string
    }>

export type BetaLocalApproval = Readonly<{
  version: typeof BETA_LOCAL_APPROVAL_VERSION
  role: BetaLocalApprovalRole
  approverIdentity: string
  approvedAt: string
  manifestSha256: string
  binding: BetaSmokeIdentity
}>

export type PromotionValidation = Readonly<{
  ok: boolean
  errors: readonly string[]
  manifest?: BetaSmokeManifest
  manifestSha256?: string
  approvals?: ReadonlyMap<BetaLocalApprovalRole, string>
}>

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

const SHA_PATTERN = /^[0-9a-f]{40,64}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const CHECKSUM_PATTERN = /^([0-9a-f]{64}) {2}manifest\.json\n$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.+Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function sortedObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedObject(record[key] ?? null)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortedObject(value as JsonValue))}\n`
}

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function identityErrors(value: unknown): string[] {
  if (!isObject(value)) return ['identity must be an object']
  const errors: string[] = []
  if (typeof value.releaseSha !== 'string' || !SHA_PATTERN.test(value.releaseSha))
    errors.push('identity.releaseSha must be a lowercase 40-64 character hex revision')
  if (typeof value.sourceRevision !== 'string' || !SHA_PATTERN.test(value.sourceRevision))
    errors.push(
      'identity.sourceRevision must be a lowercase 40-64 character hex revision',
    )
  if (
    typeof value.releaseSha === 'string' &&
    typeof value.sourceRevision === 'string' &&
    value.releaseSha !== value.sourceRevision
  )
    errors.push('identity.releaseSha must equal identity.sourceRevision')
  if (
    typeof value.lockfileRevision !== 'string' ||
    !SHA256_PATTERN.test(value.lockfileRevision)
  )
    errors.push('identity.lockfileRevision must be a lowercase sha256')
  for (const field of [
    'cleanMigrationHead',
    'upgradeMigrationHead',
    'capabilityPolicyVersion',
  ] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`identity.${field} is required`)
  }
  for (const field of [
    'stackContractHash',
    'productHash',
    'scaleHash',
    'fleetHash',
  ] as const) {
    if (typeof value[field] !== 'string' || !SHA256_PATTERN.test(value[field]))
      errors.push(`identity.${field} must be a lowercase sha256`)
  }
  if (!isObject(value.imageDigests)) {
    errors.push('identity.imageDigests must contain web, worker, provider, and perf')
  } else {
    const imageDigests = value.imageDigests
    const requiredImages = ['web', 'worker', 'provider', 'perf'] as const
    if (
      Object.keys(imageDigests).length !== requiredImages.length ||
      requiredImages.some(
        (name) => !IMAGE_DIGEST_PATTERN.test(String(imageDigests[name])),
      )
    )
      errors.push('identity.imageDigests must contain web, worker, provider, and perf')
  }
  return errors
}

function commandErrors(value: unknown, prefix: string): string[] {
  if (!isObject(value)) return [`${prefix} must be an object`]
  const errors: string[] = []
  if (!isNonEmptyString(value.executable)) errors.push(`${prefix}.executable is required`)
  if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string'))
    errors.push(`${prefix}.args must be a string array`)
  return errors
}

function safeEvidencePath(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    !value.startsWith('/') &&
    !value.split(/[\\/]/).includes('..')
  )
}

export function validateGatePlan(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return ['gate plan must be an array']
  const errors: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    if (!isObject(raw)) {
      errors.push(`gate plan entry ${index} must be an object`)
      continue
    }
    if (
      typeof raw.id !== 'string' ||
      !REQUIRED_BETA_LOCAL_GATE_IDS.includes(raw.id as BetaLocalGateId)
    ) {
      errors.push(`gate plan entry ${index} has an unknown id`)
    } else if (seen.has(raw.id)) {
      errors.push(`duplicate gate plan id: ${raw.id}`)
    } else {
      seen.add(raw.id)
    }
    errors.push(...commandErrors(raw.command, `gate plan entry ${index}.command`))
    if (
      !Array.isArray(raw.evidence) ||
      raw.evidence.length === 0 ||
      !raw.evidence.every(safeEvidencePath)
    ) {
      errors.push(`gate plan entry ${index}.evidence must contain safe relative paths`)
    }
  }
  for (const id of REQUIRED_BETA_LOCAL_GATE_IDS) {
    if (!seen.has(id)) errors.push(`missing gate plan id: ${id}`)
  }
  return errors
}

function parseGateResult(value: unknown, index: number, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`manifest gate ${index} must be an object`)
    return
  }
  if (
    typeof value.id !== 'string' ||
    !REQUIRED_BETA_LOCAL_GATE_IDS.includes(value.id as BetaLocalGateId)
  )
    errors.push(`manifest gate ${index} has an unknown id`)
  if (value.status !== 'passed' || value.exitCode !== 0)
    errors.push(`manifest gate ${String(value.id)} is not passed`)
  errors.push(...commandErrors(value.command, `manifest gate ${index}.command`))
  if (!isIsoTimestamp(value.startedAt) || !isIsoTimestamp(value.completedAt)) {
    errors.push(`manifest gate ${String(value.id)} has invalid timestamps`)
  } else if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    errors.push(`manifest gate ${String(value.id)} completes before it starts`)
  }
  if (typeof value.outputSha256 !== 'string' || !SHA256_PATTERN.test(value.outputSha256))
    errors.push(`manifest gate ${String(value.id)} has an invalid output digest`)
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    errors.push(`manifest gate ${String(value.id)} has invalid evidence`)
  } else {
    for (const evidence of value.evidence) {
      if (
        !isObject(evidence) ||
        !safeEvidencePath(evidence.path) ||
        typeof evidence.sha256 !== 'string' ||
        !SHA256_PATTERN.test(evidence.sha256)
      )
        errors.push(`manifest gate ${String(value.id)} has invalid evidence`)
    }
  }
}

export function parseBetaSmokeManifest(content: string): {
  manifest?: BetaSmokeManifest
  errors: readonly string[]
} {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { errors: ['manifest.json is not valid JSON'] }
  }
  if (!isObject(value)) return { errors: ['manifest.json must contain an object'] }
  const errors = identityErrors(value.identity)
  if (value.version !== BETA_LOCAL_EVIDENCE_VERSION)
    errors.push(`manifest version must be ${BETA_LOCAL_EVIDENCE_VERSION}`)
  if (!isIsoTimestamp(value.startedAt) || !isIsoTimestamp(value.completedAt)) {
    errors.push('manifest timestamps are invalid')
  } else if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    errors.push('manifest completes before it starts')
  }
  if (!Array.isArray(value.gates)) {
    errors.push('manifest gates must be an array')
  } else {
    const seen = new Set<string>()
    value.gates.forEach((gate, index) => {
      parseGateResult(gate, index, errors)
      if (isObject(gate) && typeof gate.id === 'string') {
        if (seen.has(gate.id)) errors.push(`duplicate manifest gate: ${gate.id}`)
        seen.add(gate.id)
      }
      if (
        isObject(gate) &&
        isIsoTimestamp(gate.startedAt) &&
        isIsoTimestamp(gate.completedAt) &&
        isIsoTimestamp(value.startedAt) &&
        isIsoTimestamp(value.completedAt) &&
        (Date.parse(gate.startedAt) < Date.parse(value.startedAt) ||
          Date.parse(gate.completedAt) > Date.parse(value.completedAt))
      )
        errors.push(`manifest gate ${String(gate.id)} falls outside manifest time`)
    })
    for (const id of REQUIRED_BETA_LOCAL_GATE_IDS) {
      if (!seen.has(id)) errors.push(`missing manifest gate: ${id}`)
    }
  }
  return errors.length === 0
    ? { manifest: value as BetaSmokeManifest, errors }
    : { errors }
}

export async function executeBetaSmokeGates(options: {
  identity: BetaSmokeIdentity
  plan: readonly BetaGatePlan[]
  runner: BetaCommandRunner
  readEvidence: (path: string) => string | Uint8Array
  now?: () => Date
}): Promise<BetaSmokeExecution> {
  const planErrors = validateGatePlan(options.plan)
  const identityProblems = identityErrors(options.identity)
  if (planErrors.length > 0 || identityProblems.length > 0)
    throw new Error([...identityProblems, ...planErrors].join('; '))

  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const results: BetaGateResult[] = []
  for (const gate of options.plan) {
    const gateStartedAt = now().toISOString()
    const result = await options.runner(gate.command)
    if (result.exitCode !== 0) {
      return {
        ok: false,
        failedGate: gate.id,
        exitCode: result.exitCode,
        stderr: result.stderr,
      }
    }
    const evidence: BetaGateEvidence[] = []
    try {
      for (const path of gate.evidence)
        evidence.push({ path, sha256: sha256(options.readEvidence(path)) })
    } catch (error) {
      return {
        ok: false,
        failedGate: gate.id,
        exitCode: 1,
        stderr: `gate evidence is missing or unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
    const gateCompletedAt = now().toISOString()
    results.push({
      id: gate.id,
      status: 'passed',
      command: gate.command,
      startedAt: gateStartedAt,
      completedAt: gateCompletedAt,
      exitCode: 0,
      outputSha256: sha256(`${result.stdout}\u0000${result.stderr}`),
      evidence,
    })
  }
  return {
    ok: true,
    manifest: {
      version: BETA_LOCAL_EVIDENCE_VERSION,
      identity: options.identity,
      startedAt,
      completedAt: now().toISOString(),
      gates: results,
    },
  }
}

function assertInside(root: string, candidate: string): void {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  if (candidatePath !== rootPath && !candidatePath.startsWith(`${rootPath}${sep}`))
    throw new Error(`path resolves outside evidence root: ${candidate}`)
}

export function persistBetaSmokeManifest(options: {
  outputRoot: string
  manifest: BetaSmokeManifest
}): Readonly<{
  manifestSha256: string
  manifestPath: string
  checksumPath: string
}> {
  const manifestText = canonicalJson(options.manifest)
  const parsed = parseBetaSmokeManifest(manifestText)
  if (!parsed.manifest) throw new Error(parsed.errors.join('; '))
  const digest = sha256(manifestText)
  const releaseDir = resolve(options.outputRoot, options.manifest.identity.releaseSha)
  const targetDir = resolve(releaseDir, digest)
  assertInside(options.outputRoot, targetDir)
  mkdirSync(resolve(options.outputRoot), { recursive: true })
  if (existsSync(releaseDir))
    throw new Error(
      `release SHA ${options.manifest.identity.releaseSha} already has evidence`,
    )
  try {
    mkdirSync(releaseDir)
  } catch (error) {
    if (existsSync(releaseDir))
      throw new Error(
        `release SHA ${options.manifest.identity.releaseSha} already has evidence`,
        { cause: error },
      )
    throw error
  }
  const temporaryDir = join(releaseDir, `.tmp-${randomUUID()}`)
  try {
    mkdirSync(temporaryDir)
    writeFileSync(join(temporaryDir, 'manifest.json'), manifestText, {
      encoding: 'utf8',
      flag: 'wx',
    })
    writeFileSync(join(temporaryDir, 'manifest.sha256'), `${digest}  manifest.json\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    renameSync(temporaryDir, targetDir)
  } catch (error) {
    rmSync(releaseDir, { recursive: true, force: true })
    throw error
  }
  return {
    manifestSha256: digest,
    manifestPath: join(targetDir, 'manifest.json'),
    checksumPath: join(targetDir, 'manifest.sha256'),
  }
}

function parseApproval(
  content: string,
  filename: string,
): {
  approval?: BetaLocalApproval
  errors: string[]
} {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { errors: [`${filename} is not valid JSON`] }
  }
  if (!isObject(value)) return { errors: [`${filename} must contain an object`] }
  const errors: string[] = []
  if (value.version !== BETA_LOCAL_APPROVAL_VERSION)
    errors.push(`${filename} has an invalid approval version`)
  if (
    typeof value.role !== 'string' ||
    !REQUIRED_APPROVAL_ROLES.includes(value.role as BetaLocalApprovalRole)
  )
    errors.push(`${filename} has an invalid approval role`)
  if (!isNonEmptyString(value.approverIdentity))
    errors.push(`${filename} is missing approverIdentity`)
  if (!isIsoTimestamp(value.approvedAt))
    errors.push(`${filename} has an invalid approvedAt`)
  if (
    typeof value.manifestSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.manifestSha256)
  )
    errors.push(`${filename} has an invalid manifestSha256`)
  errors.push(...identityErrors(value.binding).map((error) => `${filename}: ${error}`))
  return errors.length === 0
    ? { approval: value as unknown as BetaLocalApproval, errors }
    : { errors }
}

export function validatePromotionEvidence(options: {
  manifestContent: string
  checksumContent: string
  approvalFiles: ReadonlyMap<string, string>
}): PromotionValidation {
  const errors: string[] = []
  const manifestDigest = sha256(options.manifestContent)
  const checksumMatch = CHECKSUM_PATTERN.exec(options.checksumContent)
  if (!checksumMatch) {
    errors.push('manifest.sha256 has invalid syntax')
  } else if (checksumMatch[1] !== manifestDigest) {
    errors.push('manifest checksum does not match manifest.json')
  }
  const parsedManifest = parseBetaSmokeManifest(options.manifestContent)
  errors.push(...parsedManifest.errors)
  const approvalsByRole = new Map<BetaLocalApprovalRole, string>()
  if (parsedManifest.manifest) {
    for (const [filename, content] of options.approvalFiles) {
      const parsed = parseApproval(content, filename)
      errors.push(...parsed.errors)
      if (!parsed.approval) continue
      const approval = parsed.approval
      if (approvalsByRole.has(approval.role)) {
        errors.push(`duplicate approval role: ${approval.role}`)
        continue
      }
      approvalsByRole.set(approval.role, content)
      if (approval.manifestSha256 !== manifestDigest)
        errors.push(`approval ${approval.role} is bound to a different manifest`)
      if (
        canonicalJson(approval.binding) !==
        canonicalJson(parsedManifest.manifest.identity)
      )
        errors.push(`approval ${approval.role} has mismatched identity binding`)
      if (
        Date.parse(approval.approvedAt) <= Date.parse(parsedManifest.manifest.completedAt)
      )
        errors.push(`approval ${approval.role} does not postdate final evidence`)
    }
  }
  for (const role of REQUIRED_APPROVAL_ROLES) {
    if (!approvalsByRole.has(role)) errors.push(`missing required approval role: ${role}`)
  }
  return {
    ok: errors.length === 0,
    errors,
    manifest: parsedManifest.manifest,
    manifestSha256: manifestDigest,
    approvals: approvalsByRole,
  }
}

function approvalFilename(role: BetaLocalApprovalRole): string {
  return `${role.replaceAll('/', '__')}.json`
}

export function promoteLocalEvidence(options: {
  manifestPath: string
  approvalsDir: string
  evidenceRoot: string
  gateEvidenceRoot?: string
}): Readonly<{ bundleDir: string; indexPath: string }> {
  const manifestPath = resolve(options.manifestPath)
  const checksumPath = join(dirname(manifestPath), 'manifest.sha256')
  const approvalFiles = new Map<string, string>()
  for (const entry of readdirSync(options.approvalsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json'))
      approvalFiles.set(
        entry.name,
        readFileSync(join(options.approvalsDir, entry.name), 'utf8'),
      )
  }
  const validation = validatePromotionEvidence({
    manifestContent: readFileSync(manifestPath, 'utf8'),
    checksumContent: readFileSync(checksumPath, 'utf8'),
    approvalFiles,
  })
  if (
    !validation.ok ||
    !validation.manifest ||
    !validation.manifestSha256 ||
    !validation.approvals
  )
    throw new Error(validation.errors.join('; '))
  const sourceDigestDir = dirname(manifestPath)
  const sourceReleaseDir = dirname(sourceDigestDir)
  if (basename(sourceDigestDir) !== validation.manifestSha256)
    throw new Error('source evidence directory does not match the manifest digest')
  if (basename(sourceReleaseDir) !== validation.manifest.identity.releaseSha)
    throw new Error('source evidence directory does not match the release SHA')
  const configuredGateEvidenceRoot = resolve(options.gateEvidenceRoot ?? process.cwd())
  const gateEvidenceRoot = existsSync(configuredGateEvidenceRoot)
    ? realpathSync(configuredGateEvidenceRoot)
    : configuredGateEvidenceRoot
  const gateEvidencePayloads = new Map<string, Uint8Array>()
  for (const gate of validation.manifest.gates) {
    for (const evidence of gate.evidence) {
      const evidencePath = resolve(gateEvidenceRoot, evidence.path)
      assertInside(gateEvidenceRoot, evidencePath)
      if (!existsSync(evidencePath))
        throw new Error(`missing gate evidence file: ${evidence.path}`)
      assertInside(gateEvidenceRoot, realpathSync(evidencePath))
      const payload = readFileSync(evidencePath)
      if (sha256(payload) !== evidence.sha256)
        throw new Error(`gate evidence checksum mismatch: ${evidence.path}`)
      gateEvidencePayloads.set(evidence.path, payload)
    }
  }

  const releaseSha = validation.manifest.identity.releaseSha
  const releaseDir = resolve(options.evidenceRoot, releaseSha)
  const bundleDir = resolve(releaseDir, validation.manifestSha256)
  const indexPath = resolve(releaseDir, 'index.json')
  assertInside(options.evidenceRoot, bundleDir)
  if (existsSync(releaseDir))
    throw new Error(`release SHA ${releaseSha} has already been promoted`)

  const temporaryDir = resolve(options.evidenceRoot, `.tmp-${releaseSha}-${randomUUID()}`)
  mkdirSync(join(temporaryDir, validation.manifestSha256, 'approvals'), {
    recursive: true,
  })
  try {
    writeFileSync(
      join(temporaryDir, validation.manifestSha256, 'manifest.json'),
      readFileSync(manifestPath, 'utf8'),
      { encoding: 'utf8', flag: 'wx' },
    )
    writeFileSync(
      join(temporaryDir, validation.manifestSha256, 'manifest.sha256'),
      readFileSync(checksumPath, 'utf8'),
      { encoding: 'utf8', flag: 'wx' },
    )
    const approvalIndex: Record<string, Readonly<{ path: string; sha256: string }>> = {}
    for (const role of REQUIRED_APPROVAL_ROLES) {
      const filename = approvalFilename(role)
      const content = validation.approvals.get(role)
      if (content == null) throw new Error(`missing validated approval: ${role}`)
      const relativePath = `approvals/${filename}`
      writeFileSync(
        join(temporaryDir, validation.manifestSha256, relativePath),
        content,
        { encoding: 'utf8', flag: 'wx' },
      )
      approvalIndex[role] = {
        path: `${validation.manifestSha256}/${relativePath}`,
        sha256: sha256(content),
      }
    }
    const gateEvidenceIndex: Record<
      string,
      Readonly<{ path: string; sha256: string }>
    > = {}
    for (const [sourcePath, payload] of gateEvidencePayloads) {
      const relativePath = `evidence/${sourcePath}`
      const destination = join(temporaryDir, validation.manifestSha256, relativePath)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, payload, { flag: 'wx' })
      gateEvidenceIndex[sourcePath] = {
        path: `${validation.manifestSha256}/${relativePath}`,
        sha256: sha256(payload),
      }
    }
    const index = {
      version: BETA_LOCAL_INDEX_VERSION,
      releaseSha,
      manifestSha256: validation.manifestSha256,
      manifest: `${validation.manifestSha256}/manifest.json`,
      checksum: `${validation.manifestSha256}/manifest.sha256`,
      approvals: approvalIndex,
      gateEvidence: gateEvidenceIndex,
    }
    writeFileSync(join(temporaryDir, 'index.json'), canonicalJson(index), {
      encoding: 'utf8',
      flag: 'wx',
    })
    mkdirSync(dirname(releaseDir), { recursive: true })
    renameSync(temporaryDir, releaseDir)
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true })
    throw error
  }
  return { bundleDir, indexPath }
}

export function validatePromotedLocalEvidence(options: {
  releaseDir: string
  expectedManifestSha256?: string
}): PromotionValidation {
  const indexPath = join(options.releaseDir, 'index.json')
  let index: unknown
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {
    return { ok: false, errors: ['local evidence index.json is missing or invalid'] }
  }
  if (!isObject(index))
    return { ok: false, errors: ['local evidence index must be an object'] }
  const errors: string[] = []
  if (index.version !== BETA_LOCAL_INDEX_VERSION)
    errors.push('local evidence index version is invalid')
  if (
    typeof index.manifestSha256 !== 'string' ||
    !SHA256_PATTERN.test(index.manifestSha256)
  )
    errors.push('local evidence index manifestSha256 is invalid')
  if (
    options.expectedManifestSha256 &&
    index.manifestSha256 !== options.expectedManifestSha256
  )
    errors.push('local evidence index points to a different manifest digest')
  if (!isNonEmptyString(index.releaseSha))
    errors.push('local evidence index releaseSha is invalid')
  if (!isNonEmptyString(index.manifest) || !isNonEmptyString(index.checksum))
    errors.push('local evidence index manifest/checksum paths are invalid')
  if (!isObject(index.approvals)) {
    errors.push('local evidence index approvals are invalid')
  } else if (Object.keys(index.approvals).length !== REQUIRED_APPROVAL_ROLES.length) {
    errors.push('local evidence index must contain exactly five approvals')
  }
  if (!isObject(index.gateEvidence))
    errors.push('local evidence index gateEvidence is invalid')
  if (errors.length > 0) return { ok: false, errors }

  const indexDigest = String(index.manifestSha256)
  if (index.manifest !== `${indexDigest}/manifest.json`)
    errors.push('local evidence index manifest path is not digest-bound')
  if (index.checksum !== `${indexDigest}/manifest.sha256`)
    errors.push('local evidence index checksum path is not digest-bound')
  if (index.releaseSha !== basename(resolve(options.releaseDir)))
    errors.push('local evidence index releaseSha does not match its directory')
  if (errors.length > 0) return { ok: false, errors }

  const releaseRoot = resolve(options.releaseDir)
  const readIndexed = (path: string): string => {
    const filePath = resolve(releaseRoot, path)
    assertInside(releaseRoot, filePath)
    return readFileSync(filePath, 'utf8')
  }
  const readIndexedBytes = (path: string): Uint8Array => {
    const filePath = resolve(releaseRoot, path)
    assertInside(releaseRoot, filePath)
    return readFileSync(filePath)
  }
  const approvalFiles = new Map<string, string>()
  try {
    for (const role of REQUIRED_APPROVAL_ROLES) {
      const entry = (index.approvals as Record<string, unknown>)[role]
      const expectedPath = `${indexDigest}/approvals/${approvalFilename(role)}`
      if (
        !isObject(entry) ||
        entry.path !== expectedPath ||
        typeof entry.sha256 !== 'string' ||
        !SHA256_PATTERN.test(entry.sha256)
      ) {
        errors.push(`local evidence index approval is not role-bound: ${role}`)
        continue
      }
      const content = readIndexed(expectedPath)
      if (sha256(content) !== entry.sha256) {
        errors.push(`local evidence approval checksum mismatch: ${role}`)
        continue
      }
      approvalFiles.set(approvalFilename(role), content)
    }
    if (errors.length > 0) return { ok: false, errors }
    const validation = validatePromotionEvidence({
      manifestContent: readIndexed(String(index.manifest)),
      checksumContent: readIndexed(String(index.checksum)),
      approvalFiles,
    })
    if (validation.manifestSha256 !== index.manifestSha256)
      return {
        ...validation,
        ok: false,
        errors: [
          ...validation.errors,
          'local evidence index digest does not match manifest',
        ],
      }
    if (validation.manifest && isObject(index.gateEvidence)) {
      const expectedEvidence = new Map<string, string>()
      for (const gate of validation.manifest.gates) {
        for (const evidence of gate.evidence) {
          const prior = expectedEvidence.get(evidence.path)
          if (prior && prior !== evidence.sha256)
            errors.push(`conflicting manifest evidence digest: ${evidence.path}`)
          expectedEvidence.set(evidence.path, evidence.sha256)
        }
      }
      if (Object.keys(index.gateEvidence).length !== expectedEvidence.size)
        errors.push('local evidence index gateEvidence count does not match manifest')
      for (const [sourcePath, expectedSha256] of expectedEvidence) {
        const entry = index.gateEvidence[sourcePath]
        const expectedPath = `${indexDigest}/evidence/${sourcePath}`
        if (
          !isObject(entry) ||
          entry.path !== expectedPath ||
          entry.sha256 !== expectedSha256
        ) {
          errors.push(`local gate evidence index mismatch: ${sourcePath}`)
          continue
        }
        if (sha256(readIndexedBytes(expectedPath)) !== expectedSha256)
          errors.push(`local gate evidence checksum mismatch: ${sourcePath}`)
      }
      const releaseGate = validation.manifest.gates.find(
        (gate) => gate.id === 'release-bundle',
      )
      let identityObservationFound = false
      for (const evidence of releaseGate?.evidence ?? []) {
        const indexedPath = `${indexDigest}/evidence/${evidence.path}`
        let observed: unknown
        try {
          observed = JSON.parse(
            Buffer.from(readIndexedBytes(indexedPath)).toString('utf8'),
          ) as unknown
        } catch {
          continue
        }
        if (
          isObject(observed) &&
          observed.evidenceKind === 'observed-beta-smoke-identity'
        ) {
          identityObservationFound = true
          if (
            canonicalJson(observed.identity) !==
            canonicalJson(validation.manifest.identity)
          )
            errors.push('manifest identity does not match observed gate identity')
        }
      }
      if (!identityObservationFound)
        errors.push('release-bundle gate is missing observed identity evidence')
    }
    if (
      validation.manifest &&
      validation.manifest.identity.releaseSha !== basename(releaseRoot)
    )
      errors.push('release directory does not match manifest release SHA')
    if (errors.length > 0)
      return {
        ...validation,
        ok: false,
        errors: [...validation.errors, ...errors],
      }
    return validation
  } catch (error) {
    return {
      ok: false,
      errors: [
        ...errors,
        `local evidence file is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
}
