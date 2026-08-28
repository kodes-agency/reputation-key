import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { parsePromotionManifest } from './promotion-manifest'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  candidateBindingErrors,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
import {
  deployedCriticalJourneyDependencyDigests,
  parseDeployedCriticalJourneyEvidence,
} from './deployed-critical-journey-evidence'
import {
  canaryWindowDependencyDigests,
  parseCanaryWindowEvidence,
} from './canary-window-evidence'
import {
  parseRecoveryRehearsalEvidence,
  recoveryRehearsalDependencyDigests,
} from './recovery-rehearsal-evidence'

export const GATE_F_EVIDENCE_VERSION = 'repkey-gate-f-evidence-1' as const

export const GATE_F_REQUIRED_GATE_IDS = [
  'candidate.clean_ci',
  'candidate.independent_review',
  'candidate.defect_disposition',
  'preproduction.isolated_restore_migration',
  'preproduction.provider_stub_journeys',
  'preproduction.live_provider_journeys',
  'preproduction.portal_privacy',
  'preproduction.manager_journeys',
  'preproduction.observability_content_inspection',
  'promotion.railway_no_drift',
  'promotion.backup_pitr',
  'promotion.migration_integrity',
  'promotion.release_identity_health_controls',
  'promotion.deployed_critical_journeys',
  'promotion.canary_window',
  'promotion.restore_rollback',
  'promotion.dormant_cell_denial',
  'opening.cohort_readiness',
] as const

export const GATE_F_REQUIRED_APPROVAL_ROLES = [
  'counsel',
  'founder',
  'operations',
  'product',
  'security',
  'support_incident',
] as const

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)
const sourceRevision = z.string().regex(/^[0-9a-f]{40}$/u)
const isoTimestamp = z.iso.datetime({ offset: false })
const boundedIdentity = z.string().trim().min(1).max(256)
const safeEvidencePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !value.split('/').includes('.') &&
      !value.split('/').includes(''),
    'must be a normalized relative path without empty or parent segments',
  )

const evidenceReferenceSchema = z
  .object({
    path: safeEvidencePath,
    sha256,
    capturedAt: isoTimestamp,
  })
  .strict()

const gateSchema = z
  .object({
    id: z.enum(GATE_F_REQUIRED_GATE_IDS),
    status: z.literal('passed'),
    evidence: z.array(evidenceReferenceSchema).min(1),
  })
  .strict()

const approvalBaseSchema = z
  .object({
    approverIdentity: boundedIdentity,
    approvedAt: isoTimestamp,
    releaseManifestSha256: sha256,
    evidence: evidenceReferenceSchema,
  })
  .strict()

const approvalSchema = z.discriminatedUnion('role', [
  approvalBaseSchema.extend({
    role: z.literal('counsel'),
    legalRevisionSetSha256: sha256,
  }),
  approvalBaseSchema.extend({
    role: z.literal('founder'),
    legalRevisionSetSha256: sha256,
  }),
  approvalBaseSchema.extend({ role: z.literal('operations') }),
  approvalBaseSchema.extend({ role: z.literal('product') }),
  approvalBaseSchema.extend({ role: z.literal('security') }),
  approvalBaseSchema.extend({ role: z.literal('support_incident') }),
])

const gateFEvidenceSchema = z
  .object({
    version: z.literal(GATE_F_EVIDENCE_VERSION),
    release: z
      .object({
        manifest: evidenceReferenceSchema,
        signatureBundle: evidenceReferenceSchema,
        legalRevisionSet: evidenceReferenceSchema,
        releaseSha: sourceRevision,
        cell: z.literal('us'),
        environment: z.literal('cell-us'),
        deploymentProfile: z.literal('production'),
        projectName: z.literal(PRODUCTION_RAILWAY_PROJECT_NAME),
        projectId: boundedIdentity,
        environmentId: boundedIdentity,
        appOrigin: z.literal('https://us.reputationkey.app'),
      })
      .strict(),
    gates: z.array(gateSchema),
    findings: z
      .object({
        protectedReachableHighCount: z.literal(0),
        register: evidenceReferenceSchema,
      })
      .strict(),
    approvals: z.array(approvalSchema),
    firstCohort: z
      .object({
        kind: z.literal('design_partner'),
        cohortReferenceSha256: sha256,
        supportOwner: boundedIdentity,
        incidentOwner: boundedIdentity,
        changeRecord: boundedIdentity,
        evidence: evidenceReferenceSchema,
      })
      .strict(),
    completedAt: isoTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const gateIds = value.gates.map(({ id }) => id)
    const uniqueGateIds = new Set(gateIds)
    if (uniqueGateIds.size !== gateIds.length) {
      context.addIssue({ code: 'custom', path: ['gates'], message: 'duplicate gate id' })
    }
    for (const id of GATE_F_REQUIRED_GATE_IDS) {
      if (!uniqueGateIds.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['gates'],
          message: `missing required Gate F gate ${id}`,
        })
      }
    }
    if (
      gateIds.length !== GATE_F_REQUIRED_GATE_IDS.length ||
      gateIds.some((id, index) => id !== GATE_F_REQUIRED_GATE_IDS[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gates'],
        message: 'Gate F gate set and canonical order must be exact',
      })
    }

    const approvalRoles = value.approvals.map(({ role }) => role)
    const uniqueApprovalRoles = new Set(approvalRoles)
    if (uniqueApprovalRoles.size !== approvalRoles.length) {
      context.addIssue({
        code: 'custom',
        path: ['approvals'],
        message: 'duplicate approval role',
      })
    }
    for (const role of GATE_F_REQUIRED_APPROVAL_ROLES) {
      if (!uniqueApprovalRoles.has(role)) {
        context.addIssue({
          code: 'custom',
          path: ['approvals'],
          message: `missing required Gate F approval ${role}`,
        })
      }
    }
    if (
      approvalRoles.length !== GATE_F_REQUIRED_APPROVAL_ROLES.length ||
      approvalRoles.some((role, index) => role !== GATE_F_REQUIRED_APPROVAL_ROLES[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approvals'],
        message: 'Gate F approval set and canonical order must be exact',
      })
    }

    const manifestSha256 = value.release.manifest.sha256
    for (const [index, approval] of value.approvals.entries()) {
      if (approval.releaseManifestSha256 !== manifestSha256) {
        context.addIssue({
          code: 'custom',
          path: ['approvals', index, 'releaseManifestSha256'],
          message: 'approval must bind the release manifest digest',
        })
      }
      if (
        (approval.role === 'counsel' || approval.role === 'founder') &&
        approval.legalRevisionSetSha256 !== value.release.legalRevisionSet.sha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['approvals', index, 'legalRevisionSetSha256'],
          message: 'counsel and founder must bind the legal revision-set digest',
        })
      }
    }

    const finalDecisionEvidenceAt = Math.max(
      Date.parse(value.release.manifest.capturedAt),
      Date.parse(value.release.signatureBundle.capturedAt),
      Date.parse(value.release.legalRevisionSet.capturedAt),
      ...value.gates.flatMap(({ evidence }) =>
        evidence.map(({ capturedAt }) => Date.parse(capturedAt)),
      ),
      Date.parse(value.findings.register.capturedAt),
      Date.parse(value.firstCohort.evidence.capturedAt),
    )
    for (const [index, approval] of value.approvals.entries()) {
      if (Date.parse(approval.approvedAt) < finalDecisionEvidenceAt) {
        context.addIssue({
          code: 'custom',
          path: ['approvals', index, 'approvedAt'],
          message: 'approval predates final release evidence',
        })
      }
    }
    const finalApprovalAt = Math.max(
      ...value.approvals.map(({ approvedAt }) => Date.parse(approvedAt)),
    )
    const finalApprovalArtifactAt = Math.max(
      ...value.approvals.map(({ evidence }) => Date.parse(evidence.capturedAt)),
    )
    if (
      Date.parse(value.completedAt) <
      Math.max(finalDecisionEvidenceAt, finalApprovalAt, finalApprovalArtifactAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completion predates evidence or approval',
      })
    }
  })

export type GateFEvidenceReference = z.infer<typeof evidenceReferenceSchema>
export type GateFEvidence = z.infer<typeof gateFEvidenceSchema>

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedJson(record[key] ?? null)]),
    )
  }
  return value
}

export function canonicalGateFEvidence(value: GateFEvidence): string {
  return `${JSON.stringify(sortedJson(value as JsonValue))}\n`
}

export function gateFEvidenceSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export type GateFEvidenceParseResult =
  | Readonly<{ ok: true; evidence: GateFEvidence; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseGateFEvidence(content: string): GateFEvidenceParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['Gate F index is not valid JSON'] }
  }
  const parsed = gateFEvidenceSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalGateFEvidence(parsed.data)
  if (canonical !== content) {
    return { ok: false, errors: ['Gate F index must use canonical JSON encoding'] }
  }
  return { ok: true, evidence: parsed.data, digest: gateFEvidenceSha256(canonical) }
}

function evidenceReferences(
  evidence: GateFEvidence,
): readonly Readonly<{ label: string; reference: GateFEvidenceReference }>[] {
  return [
    { label: 'release.manifest', reference: evidence.release.manifest },
    {
      label: 'release.signatureBundle',
      reference: evidence.release.signatureBundle,
    },
    {
      label: 'release.legalRevisionSet',
      reference: evidence.release.legalRevisionSet,
    },
    ...evidence.gates.flatMap((gate) =>
      gate.evidence.map((reference, index) => ({
        label: `gates.${gate.id}.evidence.${String(index)}`,
        reference,
      })),
    ),
    { label: 'findings.register', reference: evidence.findings.register },
    ...evidence.approvals.map((approval) => ({
      label: `approvals.${approval.role}.evidence`,
      reference: approval.evidence,
    })),
    { label: 'firstCohort.evidence', reference: evidence.firstCohort.evidence },
  ]
}

export type GateFEvidenceValidationResult =
  | Readonly<{ ok: true; evidence: GateFEvidence; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function validateTypedPromotionArtifact(input: {
  label: string
  content: string
  referencedAt: string
  candidate: ReleaseCandidateBinding
  retainedDigests: ReadonlySet<string>
}): readonly string[] {
  let evidence:
    | Readonly<{
        candidate: ReleaseCandidateBinding
        capturedAt: string
        outcome: 'passed' | 'failed'
      }>
    | undefined
  let dependencyDigests: readonly string[] = []
  let parseErrors: readonly string[] = []
  if (input.label === 'gates.promotion.deployed_critical_journeys.evidence.0') {
    const parsed = parseDeployedCriticalJourneyEvidence(input.content)
    if (parsed.ok) {
      evidence = parsed.evidence
      dependencyDigests = deployedCriticalJourneyDependencyDigests(parsed.evidence)
    } else parseErrors = parsed.errors
  } else if (input.label === 'gates.promotion.canary_window.evidence.0') {
    const parsed = parseCanaryWindowEvidence(input.content)
    if (parsed.ok) {
      evidence = parsed.evidence
      dependencyDigests = canaryWindowDependencyDigests(parsed.evidence)
    } else parseErrors = parsed.errors
  } else if (input.label === 'gates.promotion.restore_rollback.evidence.0') {
    const parsed = parseRecoveryRehearsalEvidence(input.content)
    if (parsed.ok) {
      evidence = parsed.evidence
      dependencyDigests = recoveryRehearsalDependencyDigests(parsed.evidence)
    } else parseErrors = parsed.errors
  } else return []
  if (!evidence) {
    return parseErrors.map((error) => `${input.label}: ${error}`)
  }
  const errors = candidateBindingErrors(evidence.candidate, input.candidate).map(
    (error) => `${input.label}: ${error}`,
  )
  for (const digest of new Set(dependencyDigests)) {
    if (!input.retainedDigests.has(digest)) {
      errors.push(`${input.label}: dependency ${digest} is not retained by this gate`)
    }
  }
  if (evidence.outcome !== 'passed') {
    errors.push(`${input.label}: typed promotion evidence did not pass`)
  }
  if (Date.parse(input.referencedAt) < Date.parse(evidence.capturedAt)) {
    errors.push(`${input.label}: Gate F reference predates artifact capture`)
  }
  return errors
}

/**
 * Validate the canonical index plus every byte-bound evidence reference.
 * `readEvidence` owns root containment; the repository CLI supplies a
 * path-contained implementation.
 */
export function validateGateFEvidenceBundle(
  content: string,
  readEvidence: (path: string) => Uint8Array,
): GateFEvidenceValidationResult {
  const parsed = parseGateFEvidence(content)
  if (!parsed.ok) return parsed
  const errors: string[] = []
  const observedByPath = new Map<string, string>()
  let manifestContent: string | undefined
  const retainedGateDigests = new Map(
    parsed.evidence.gates.map((gate) => [
      `gates.${gate.id}.evidence.0`,
      new Set(gate.evidence.map(({ sha256 }) => sha256)),
    ]),
  )
  const expectedCandidate: ReleaseCandidateBinding = {
    releaseSha: parsed.evidence.release.releaseSha,
    releaseManifestSha256: parsed.evidence.release.manifest.sha256,
    cell: parsed.evidence.release.cell,
    environment: parsed.evidence.release.environment,
    deploymentProfile: parsed.evidence.release.deploymentProfile,
    projectName: parsed.evidence.release.projectName,
    projectId: parsed.evidence.release.projectId,
    environmentId: parsed.evidence.release.environmentId,
    appOrigin: parsed.evidence.release.appOrigin,
  }
  for (const { label, reference } of evidenceReferences(parsed.evidence)) {
    const priorDigest = observedByPath.get(reference.path)
    if (priorDigest && priorDigest !== reference.sha256) {
      errors.push(`${label}: reused evidence path has a different digest`)
      continue
    }
    observedByPath.set(reference.path, reference.sha256)
    let payload: Uint8Array
    try {
      payload = readEvidence(reference.path)
    } catch (error) {
      errors.push(
        `${label}: evidence is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    if (gateFEvidenceSha256(payload) !== reference.sha256) {
      errors.push(`${label}: evidence digest mismatch`)
      continue
    }
    errors.push(
      ...validateTypedPromotionArtifact({
        label,
        content: Buffer.from(payload).toString('utf8'),
        referencedAt: reference.capturedAt,
        candidate: expectedCandidate,
        retainedDigests: retainedGateDigests.get(label) ?? new Set<string>(),
      }),
    )
    if (label === 'release.manifest') {
      manifestContent = Buffer.from(payload).toString('utf8')
    }
  }

  if (manifestContent) {
    const manifest = parsePromotionManifest(manifestContent)
    if (!manifest.ok) {
      errors.push(`release.manifest: ${manifest.errors.join('; ')}`)
    } else {
      if (manifest.digest !== parsed.evidence.release.manifest.sha256) {
        errors.push('release.manifest: parsed digest does not match its evidence ref')
      }
      if (manifest.manifest.releaseSha !== parsed.evidence.release.releaseSha) {
        errors.push('release.manifest: release SHA does not match Gate F index')
      }
      if (
        Date.parse(parsed.evidence.release.manifest.capturedAt) <
        Date.parse(manifest.manifest.createdAt)
      ) {
        errors.push('release.manifest: evidence capture predates manifest creation')
      }
      if (
        Date.parse(parsed.evidence.release.signatureBundle.capturedAt) <
        Date.parse(manifest.manifest.createdAt)
      ) {
        errors.push('release.signatureBundle: capture predates manifest creation')
      }
      if (manifest.manifest.cells.length !== 1 || manifest.manifest.cells[0] !== 'us') {
        errors.push('release.manifest: beta manifest must contain only us')
      }
    }
  }

  return errors.length === 0
    ? { ok: true, evidence: parsed.evidence, digest: parsed.digest }
    : { ok: false, errors }
}
