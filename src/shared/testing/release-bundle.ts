// BQC-8.8 — immutable beta release bundle validation.
//
// The release bundle is reviewer-facing Markdown, but its identity, finding,
// gate, and approval assertions are explicit machine-readable comment markers.
// This keeps reports easy to read while making it impossible for a script to
// silently treat a template, mixed candidate, soft gate, or early approval as
// release evidence.

import {
  BETA_LOCAL_EVIDENCE_VERSION,
  BETA_LOCAL_REQUIRED_GATE_IDS,
} from '#/shared/bqc/status-schema'
import { parseManifest } from './scale-dataset'

export const BETA_RELEASE_EVIDENCE_FILES = [
  'manifest.md',
  'finding-closure.md',
  'quality-gates.md',
  'migration-and-schema.md',
  'source-data-governance.md',
  'authorization-and-capabilities.md',
  'event-and-job-reliability.md',
  'regional-execution.md',
  'security-and-privacy.md',
  'accessibility-and-performance.md',
  'scale-and-recovery.md',
  'pilot-observations.md',
  'exceptions.md',
  'approval.md',
] as const

export const REQUIRED_APPROVAL_ROLES = [
  'engineering/runtime',
  'product/property',
  'security/privacy',
  'google-project/integration',
  'operations/on-call',
] as const

/**
 * Local controlled-beta evidence is the executable historical BQC contract.
 * It is candidate evidence only. Hosted capacity/PITR/region/provider/pilot
 * checks are outside this local schema and remain mandatory, unproved REL-01
 * gates until they run against the immutable candidate in their real
 * environment.
 *
 * These two constants used to be maintained here AND in `#/shared/bqc/status-schema`
 * under permuted names -- `REQUIRED_BETA_LOCAL_GATE_IDS` here against
 * `BETA_LOCAL_REQUIRED_GATE_IDS` there -- which is exactly why the duplication
 * survived review. They fed two disjoint pipelines (this one validates gate
 * evidence, that one validates the BQC status manifest), no test compared them,
 * and nothing would have caught a divergence.
 *
 * `status-schema` owns them because the dependency can only run this way: the
 * `.fallowrc.json` boundary rules let `shared-testing` import from `shared`, but
 * `shared` may import only `shared-events`, so the reverse would be a boundary
 * violation against a zero baseline -- and it would drag this whole beta-evidence
 * apparatus into the production zone.
 *
 * Re-exported under the local name so the four downstream consumers are untouched.
 */
export { BETA_LOCAL_EVIDENCE_VERSION }
export const REQUIRED_BETA_LOCAL_GATE_IDS = BETA_LOCAL_REQUIRED_GATE_IDS

export type ReleaseIdentity = Readonly<{
  releaseId: string
  releaseSha: string
  lockfileSha256: string
  artifactDigest: string
  migrationVersion: string
  capabilityPolicyVersion: string
  sourceContentPolicyVersion: number
  routingPolicyVersion: number
  datasetHash: string
  environment: string
  generatedAt: string
}>

export type FindingDisposition = Readonly<{
  id: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  state: 'accepted' | 'exception' | 'open'
  acceptedAt?: string
  exception?: Readonly<{
    owner: string
    impact: string
    mitigation: string
    expiresAt: string
    targetPhase: string
    approvedBy: string
  }>
}>

export type ReleaseGate = Readonly<{
  id: string
  required: boolean
  status: 'passed' | 'failed' | 'pending' | 'soft'
  completedAt?: string
  evidence: string
}>

export type ReleaseApproval = Readonly<{
  role: (typeof REQUIRED_APPROVAL_ROLES)[number]
  approvedAt: string
  reviewer: string
}>

export type ReleaseBundleManifest = Readonly<{
  identity: ReleaseIdentity
  findings: readonly FindingDisposition[]
  gates: readonly ReleaseGate[]
  approvals: readonly ReleaseApproval[]
}>

export type ReleaseBundleValidation = Readonly<{
  ok: boolean
  errors: readonly string[]
}>

const IDENTITY_MARKER = '<!-- bqc-release-identity '
const BUNDLE_MARKER = '<!-- bqc-release-bundle '
const MARKER_END = ' -->'
const TEMPLATE_CONTENT =
  /\b(?:TODO|TBD)\b|\[ \]|not executed in this environment|_template/i

/** Embed a candidate identity in every reviewer-facing Markdown document. */
export function createReleaseIdentityMarker(identity: ReleaseIdentity): string {
  return `${IDENTITY_MARKER}${JSON.stringify(identity)}${MARKER_END}`
}

/** Embed bundle dispositions in manifest.md; the reports remain human-readable. */
export function createReleaseBundleMarker(manifest: ReleaseBundleManifest): string {
  return `${BUNDLE_MARKER}${JSON.stringify(manifest)}${MARKER_END}`
}

function markerValue(content: string, prefix: string): unknown | undefined {
  const start = content.indexOf(prefix)
  if (start === -1) return undefined
  const end = content.indexOf(MARKER_END, start + prefix.length)
  if (end === -1) return undefined

  try {
    return JSON.parse(content.slice(start + prefix.length, end))
  } catch {
    return undefined
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.+Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function identityKey(identity: ReleaseIdentity): string {
  return [
    identity.releaseId,
    identity.releaseSha,
    identity.lockfileSha256,
    identity.artifactDigest,
    identity.migrationVersion,
    identity.capabilityPolicyVersion,
    identity.sourceContentPolicyVersion,
    identity.routingPolicyVersion,
    identity.datasetHash,
    identity.environment,
  ].join('|')
}

function isReleaseIdentity(value: unknown): value is ReleaseIdentity {
  if (typeof value !== 'object' || value == null) return false
  const identity = value as Record<string, unknown>
  return (
    nonEmptyString(identity.releaseId) &&
    typeof identity.releaseSha === 'string' &&
    /^[0-9a-f]{40,64}$/.test(identity.releaseSha) &&
    typeof identity.lockfileSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(identity.lockfileSha256) &&
    typeof identity.artifactDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(identity.artifactDigest) &&
    nonEmptyString(identity.migrationVersion) &&
    nonEmptyString(identity.capabilityPolicyVersion) &&
    typeof identity.sourceContentPolicyVersion === 'number' &&
    Number.isInteger(identity.sourceContentPolicyVersion) &&
    identity.sourceContentPolicyVersion >= 0 &&
    typeof identity.routingPolicyVersion === 'number' &&
    Number.isInteger(identity.routingPolicyVersion) &&
    identity.routingPolicyVersion >= 0 &&
    typeof identity.datasetHash === 'string' &&
    /^[0-9a-f]{64}$/.test(identity.datasetHash) &&
    nonEmptyString(identity.environment) &&
    isIsoTimestamp(identity.generatedAt)
  )
}

function isFinding(value: unknown): value is FindingDisposition {
  if (typeof value !== 'object' || value == null) return false
  const finding = value as Record<string, unknown>
  return (
    nonEmptyString(finding.id) &&
    (finding.severity === 'P0' ||
      finding.severity === 'P1' ||
      finding.severity === 'P2' ||
      finding.severity === 'P3') &&
    (finding.state === 'accepted' ||
      finding.state === 'exception' ||
      finding.state === 'open')
  )
}

function isGate(value: unknown): value is ReleaseGate {
  if (typeof value !== 'object' || value == null) return false
  const gate = value as Record<string, unknown>
  return (
    nonEmptyString(gate.id) &&
    typeof gate.required === 'boolean' &&
    (gate.status === 'passed' ||
      gate.status === 'failed' ||
      gate.status === 'pending' ||
      gate.status === 'soft') &&
    nonEmptyString(gate.evidence)
  )
}

function isApproval(value: unknown): value is ReleaseApproval {
  if (typeof value !== 'object' || value == null) return false
  const approval = value as Record<string, unknown>
  return (
    typeof approval.role === 'string' &&
    REQUIRED_APPROVAL_ROLES.includes(approval.role as ReleaseApproval['role']) &&
    isIsoTimestamp(approval.approvedAt) &&
    nonEmptyString(approval.reviewer)
  )
}

function isBundleManifest(value: unknown): value is ReleaseBundleManifest {
  if (typeof value !== 'object' || value == null) return false
  const manifest = value as Record<string, unknown>
  return (
    isReleaseIdentity(manifest.identity) &&
    Array.isArray(manifest.findings) &&
    manifest.findings.every(isFinding) &&
    Array.isArray(manifest.gates) &&
    manifest.gates.every(isGate) &&
    Array.isArray(manifest.approvals) &&
    manifest.approvals.every(isApproval)
  )
}

function validateFinding(
  finding: FindingDisposition,
  errors: string[],
): number | undefined {
  if (finding.state === 'accepted') {
    if (!isIsoTimestamp(finding.acceptedAt)) {
      errors.push(`accepted finding ${finding.id} is missing acceptedAt`)
      return undefined
    }
    return Date.parse(finding.acceptedAt)
  }

  if (finding.severity === 'P0' || finding.severity === 'P1') {
    errors.push(`P0/P1 finding ${finding.id} is not accepted`)
    return undefined
  }

  if (finding.state !== 'exception' || !finding.exception) {
    errors.push(`finding ${finding.id} is neither accepted nor a permitted exception`)
    return undefined
  }

  const exception = finding.exception
  if (
    !nonEmptyString(exception.owner) ||
    !nonEmptyString(exception.impact) ||
    !nonEmptyString(exception.mitigation) ||
    !isIsoTimestamp(exception.expiresAt) ||
    !nonEmptyString(exception.targetPhase) ||
    !nonEmptyString(exception.approvedBy)
  ) {
    errors.push(`exception for ${finding.id} is incomplete`)
  }
  return undefined
}

function bodyWithoutMarkers(content: string): string {
  return content
    .replace(/<!-- bqc-release-identity [\s\S]*? -->/g, '')
    .replace(/<!-- bqc-release-bundle [\s\S]*? -->/g, '')
    .trim()
}

/**
 * Validate the complete, same-candidate release evidence bundle.
 *
 * The filesystem is deliberately injected as a path→content map so this pure
 * policy is unit-testable; the CLI owns file discovery and I/O.
 */
export function validateReleaseBundle(
  files: ReadonlyMap<string, string>,
): ReleaseBundleValidation {
  const errors: string[] = []

  for (const path of BETA_RELEASE_EVIDENCE_FILES) {
    const content = files.get(path)
    if (content == null) {
      errors.push(`missing required evidence file: ${path}`)
      continue
    }
    if (!bodyWithoutMarkers(content) || TEMPLATE_CONTENT.test(content)) {
      errors.push(`template or pending content in ${path}`)
    }
  }

  const manifestContent = files.get('manifest.md')
  const bundleValue = manifestContent
    ? markerValue(manifestContent, BUNDLE_MARKER)
    : undefined
  if (!isBundleManifest(bundleValue)) {
    errors.push('manifest.md is missing a valid bqc release bundle marker')
    return { ok: false, errors }
  }
  const manifest = bundleValue
  const identity = manifest.identity

  for (const path of BETA_RELEASE_EVIDENCE_FILES) {
    const content = files.get(path)
    if (content == null) continue
    const documentIdentity = markerValue(content, IDENTITY_MARKER)
    if (!isReleaseIdentity(documentIdentity)) {
      errors.push(`missing or invalid release identity in ${path}`)
      continue
    }
    if (identityKey(documentIdentity) !== identityKey(identity)) {
      errors.push(`release identity mismatch in ${path}`)
    }
  }

  const dataset = files.get('scale-dataset.json')
  if (dataset == null) {
    errors.push('missing required evidence file: scale-dataset.json')
  } else {
    try {
      const parsedDataset = parseManifest(dataset)
      if (parsedDataset.hash !== identity.datasetHash) {
        errors.push('dataset hash does not match release identity')
      }
      if (
        parsedDataset.shape.orgs !== 100 ||
        parsedDataset.shape.properties !== 5000 ||
        parsedDataset.shape.reviews !== 500000
      ) {
        errors.push(
          'dataset manifest does not describe the required 100/5000/500000 shape',
        )
      }
    } catch {
      errors.push('scale-dataset.json is invalid')
    }
  }

  const evidenceTimes: number[] = []
  const findingIds = new Set<string>()
  for (const finding of manifest.findings) {
    if (findingIds.has(finding.id))
      errors.push(`duplicate finding disposition: ${finding.id}`)
    findingIds.add(finding.id)
    const acceptedAt = validateFinding(finding, errors)
    if (acceptedAt != null) evidenceTimes.push(acceptedAt)
  }

  if (manifest.gates.length === 0) errors.push('release bundle has no gate results')
  const gatesById = new Map<string, ReleaseGate>()
  for (const gate of manifest.gates) {
    if (gatesById.has(gate.id)) {
      errors.push(`duplicate gate result: ${gate.id}`)
      continue
    }
    gatesById.set(gate.id, gate)
    if (gate.required && gate.status !== 'passed') {
      errors.push(`required gate ${gate.id} is ${gate.status}`)
    }
    if (gate.status === 'passed') {
      if (!isIsoTimestamp(gate.completedAt)) {
        errors.push(`passed gate ${gate.id} is missing completedAt`)
      } else {
        evidenceTimes.push(Date.parse(gate.completedAt))
      }
    }
    if (!files.has(gate.evidence)) {
      errors.push(`gate ${gate.id} references missing evidence: ${gate.evidence}`)
    }
  }
  for (const id of REQUIRED_BETA_LOCAL_GATE_IDS) {
    const gate = gatesById.get(id)
    if (!gate) {
      errors.push(`missing required gate: ${id}`)
    } else if (!gate.required) {
      errors.push(`mandatory gate ${id} must be required`)
    }
  }

  const finalEvidenceAt = Math.max(Date.parse(identity.generatedAt), ...evidenceTimes)
  const approvalsByRole = new Map<string, ReleaseApproval>()
  for (const approval of manifest.approvals) {
    if (approvalsByRole.has(approval.role)) {
      errors.push(`duplicate approval role: ${approval.role}`)
      continue
    }
    approvalsByRole.set(approval.role, approval)
    if (Date.parse(approval.approvedAt) < finalEvidenceAt) {
      errors.push(`approval ${approval.role} predates final evidence`)
    }
  }
  for (const role of REQUIRED_APPROVAL_ROLES) {
    if (!approvalsByRole.has(role)) errors.push(`missing required approval role: ${role}`)
  }

  return { ok: errors.length === 0, errors }
}
