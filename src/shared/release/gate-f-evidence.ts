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
import {
  DEFAULT_LEGAL_REVISION_SET_CONTEXT,
  parseLegalRevisionSetEvidence,
  type LegalRevisionSetContext,
} from './legal-revision-set-evidence'
import {
  parseLegalApprovalChecklist,
  type LegalApprovalChecklistContext,
} from './legal-approval-checklist'
import {
  parsePromotionReadbackEvidence,
  promotionReadbackDependencyDigests,
  PROMOTION_READBACK_GATE_F_IDS,
  type PromotionReadbackGate,
} from './promotion-readback-evidence'
import { LIVE_EVIDENCE_PARSERS, type LiveEvidenceGateId } from './live-evidence'
import {
  parseGateFApprovalEnvelope,
  type GateFApprovalRole,
  type GateFApprovalVerifier,
} from './gate-f-approval-envelope'
import { RELEASE_POSTURES, type ReleasePosture } from './release-posture'

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

/**
 * Who a release is exposed to, which decides how many humans must approve it.
 *
 * The six-role set below was written for an organisation with a legal function
 * and five distinct operating owners. A closed beta whose only participant is
 * the founder has neither, and demanding six signatures there is not a control
 * — it is one person signing six times, which
 * `INDEPENDENT_OF_ENGINEERING` in gate-f-approval-envelope.ts correctly
 * REFUSES. The gate and the situation could not both be satisfied.
 *
 * So the requirement is keyed on posture rather than deleted. `closed-beta`
 * needs the founder alone; the moment the posture moves to `open-beta` — the
 * moment someone other than the operator's own staff can reach the product —
 * the full set is required again, with no one needing to remember to re-arm it.
 *
 * The vocabulary itself now lives in `release-posture.ts`, alongside the
 * constant that says which posture the product is actually in — this module
 * only ever described the posture a BUNDLE claims, which left the product's own
 * posture unstated and every other gate with nothing to consult. Re-exported
 * here because callers of this module reasonably expect the type next to the
 * function that keys on it.
 */
export { RELEASE_POSTURES, type ReleasePosture } from './release-posture'

/**
 * A closed beta is approved by the founder alone.
 *
 * This is narrower than it looks. It removes the SIGNATURES, not the evidence:
 * every gate in `GATE_F_REQUIRED_GATE_IDS` still has to be produced, still has
 * to bind its digests, and the approval still has to be a real signature over
 * the manifest and legal digests. What changes is how many people sign.
 */
const CLOSED_BETA_APPROVAL_ROLES = ['founder'] as const

/** Every role an externally-reachable release needs. */
const FULL_APPROVAL_ROLES = [
  'counsel',
  'founder',
  'operations',
  'product',
  'security',
  'support_incident',
] as const

/**
 * The canonical, ordered approval set for a posture.
 *
 * Order is load-bearing: `refineApprovalSet` requires the approvals to appear
 * in exactly this sequence, so a bundle cannot reorder them to disguise a
 * missing role.
 */
export function gateFApprovalRolesFor(
  posture: ReleasePosture,
): readonly GateFApprovalRole[] {
  return posture === 'closed-beta' ? CLOSED_BETA_APPROVAL_ROLES : FULL_APPROVAL_ROLES
}

/**
 * The full set, retained as the name other modules import.
 *
 * Consumers that describe the complete role vocabulary (the key map, the
 * envelope parser) still need every role — a closed beta narrows WHICH
 * approvals a bundle must carry, not which roles can exist.
 */
export const GATE_F_REQUIRED_APPROVAL_ROLES = FULL_APPROVAL_ROLES

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

const gateFEvidenceObjectSchema = z
  .object({
    version: z.literal(GATE_F_EVIDENCE_VERSION),
    release: z
      .object({
        manifest: evidenceReferenceSchema,
        signatureBundle: evidenceReferenceSchema,
        legalRevisionSet: evidenceReferenceSchema,
        /**
         * REL-01-T8. The revision set proves WHICH legal bytes counsel
         * approved; the checklist proves counsel DECIDED the LEG-01 facts
         * those bytes depend on and that the approval is still current. Both
         * are required — one without the other is a half-approval.
         */
        legalApprovalChecklist: evidenceReferenceSchema,
        releaseSha: sourceRevision,
        /**
         * Declared, not inferred. The bundle states who the release is exposed
         * to, and `refineApprovalSet` holds it to the approval set that posture
         * requires. Absent means `closed-beta` is NOT assumed — an older bundle
         * without the field is rejected by the enum rather than silently
         * granted the narrowest requirement.
         */
        posture: z.enum(RELEASE_POSTURES),
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

type GateFEvidenceShape = z.infer<typeof gateFEvidenceObjectSchema>

/** The eighteen gates must be present exactly once each, in canonical order. */
function refineGateSet(value: GateFEvidenceShape, context: z.RefinementCtx): void {
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
}

/**
 * Every approval role the DECLARED POSTURE requires, exactly once, in order.
 *
 * The set is chosen by `value.release.posture`, so a bundle cannot claim a
 * closed beta's single signature while declaring itself open — the posture it
 * declares is the posture it is held to, and the same posture reaches the
 * promotion manifest.
 */
function refineApprovalSet(value: GateFEvidenceShape, context: z.RefinementCtx): void {
  const requiredRoles = gateFApprovalRolesFor(value.release.posture)
  const approvalRoles = value.approvals.map(({ role }) => role)
  const uniqueApprovalRoles = new Set(approvalRoles)
  if (uniqueApprovalRoles.size !== approvalRoles.length) {
    context.addIssue({
      code: 'custom',
      path: ['approvals'],
      message: 'duplicate approval role',
    })
  }
  for (const role of requiredRoles) {
    if (!uniqueApprovalRoles.has(role)) {
      context.addIssue({
        code: 'custom',
        path: ['approvals'],
        message: `missing required Gate F approval ${role}`,
      })
    }
  }
  if (
    approvalRoles.length !== requiredRoles.length ||
    approvalRoles.some((role, index) => role !== requiredRoles[index])
  ) {
    context.addIssue({
      code: 'custom',
      path: ['approvals'],
      message: `Gate F approval set and canonical order must be exact for posture ${value.release.posture}`,
    })
  }
}

/** Each approval must bind the digests of the bytes it claims to approve. */
function refineApprovalBindings(
  value: GateFEvidenceShape,
  context: z.RefinementCtx,
): void {
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
}

/** The instant every piece of decision evidence had been captured. */
function finalDecisionEvidenceAt(value: GateFEvidenceShape): number {
  return Math.max(
    Date.parse(value.release.manifest.capturedAt),
    Date.parse(value.release.signatureBundle.capturedAt),
    Date.parse(value.release.legalRevisionSet.capturedAt),
    Date.parse(value.release.legalApprovalChecklist.capturedAt),
    ...value.gates.flatMap(({ evidence }) =>
      evidence.map(({ capturedAt }) => Date.parse(capturedAt)),
    ),
    Date.parse(value.findings.register.capturedAt),
    Date.parse(value.firstCohort.evidence.capturedAt),
  )
}

/** No approval may predate the evidence it approves, and none may follow completion. */
function refineDecisionTiming(value: GateFEvidenceShape, context: z.RefinementCtx): void {
  const evidenceAt = finalDecisionEvidenceAt(value)
  for (const [index, approval] of value.approvals.entries()) {
    if (Date.parse(approval.approvedAt) < evidenceAt) {
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
    Math.max(evidenceAt, finalApprovalAt, finalApprovalArtifactAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'completion predates evidence or approval',
    })
  }
}

const gateFEvidenceSchema = gateFEvidenceObjectSchema.superRefine((value, context) => {
  refineGateSet(value, context)
  refineApprovalSet(value, context)
  refineApprovalBindings(value, context)
  refineDecisionTiming(value, context)
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

/**
 * The Gate F DECISION — the index without its approvals.
 *
 * This is what an approver actually reads and signs: the release identity, the
 * eighteen gates, the findings register, the first cohort and the completion
 * time. The approvals themselves are excluded because a signature cannot cover
 * a document that contains it, and because each role must sign the same bytes
 * regardless of who else has signed yet.
 */
function gateFDecisionDocument(value: GateFEvidence): Readonly<Record<string, unknown>> {
  const { approvals: _approvals, ...decision } = value
  return decision
}

export function gateFDecisionSha256(value: GateFEvidence): string {
  return gateFEvidenceSha256(
    `${JSON.stringify(sortedJson(gateFDecisionDocument(value) as JsonValue))}\n`,
  )
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
    {
      label: 'release.legalApprovalChecklist',
      reference: evidence.release.legalApprovalChecklist,
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

type TypedArtifactFacts = Readonly<{
  candidate: ReleaseCandidateBinding
  capturedAt: string
  outcome: 'passed' | 'failed'
  /** Live-evidence artifacts expire; wave-2 promotion proofs do not. */
  expiresAt?: string
}>

type TypedArtifactParse = Readonly<{
  facts?: TypedArtifactFacts
  errors: readonly string[]
  dependencyDigests: readonly string[]
  /** Release-level artifacts have no owning gate to retain dependencies. */
  checkRetention: boolean
}>

/** Gate id -> the read-back gate that produces it, for the four promotion keys. */
const READBACK_GATE_BY_GATE_F_ID = Object.fromEntries(
  Object.entries(PROMOTION_READBACK_GATE_F_IDS).map(([gate, gateFId]) => [gateFId, gate]),
) as Readonly<Record<string, PromotionReadbackGate>>

/** Shape one producer's parse result into the common typed-artifact parse. */
function typedArtifactParse<Evidence extends TypedArtifactFacts>(
  parsed:
    | Readonly<{ ok: true; evidence: Evidence }>
    | Readonly<{ ok: false; errors: readonly string[] }>,
  checkRetention: boolean,
  dependencyDigests: (evidence: Evidence) => readonly string[] = () => [],
): TypedArtifactParse {
  return parsed.ok
    ? {
        facts: parsed.evidence,
        errors: [],
        dependencyDigests: dependencyDigests(parsed.evidence),
        checkRetention,
      }
    : { errors: parsed.errors, dependencyDigests: [], checkRetention }
}

/** Release-level artifacts, which have no owning gate to retain dependencies. */
function parseReleaseArtifact(
  label: string,
  content: string,
  options: GateFValidationOptions,
): TypedArtifactParse | undefined {
  if (label === 'release.legalRevisionSet') {
    return typedArtifactParse(
      parseLegalRevisionSetEvidence(
        content,
        options.legalRevisionSet ?? DEFAULT_LEGAL_REVISION_SET_CONTEXT,
      ),
      false,
    )
  }
  if (label === 'release.legalApprovalChecklist') {
    const parsed = parseLegalApprovalChecklist(content, options.legalDocuments)
    return parsed.ok
      ? {
          facts: { ...parsed.evidence, outcome: parsed.evidence.outcome },
          errors: [],
          dependencyDigests: [],
          checkRetention: false,
        }
      : { errors: parsed.errors, dependencyDigests: [], checkRetention: false }
  }
  return undefined
}

/** A gate's primary proof, dispatched to the producer that emits it. */
function parseGateArtifact(
  gateId: string,
  content: string,
): TypedArtifactParse | undefined {
  if (gateId === 'promotion.deployed_critical_journeys') {
    return typedArtifactParse(
      parseDeployedCriticalJourneyEvidence(content),
      true,
      deployedCriticalJourneyDependencyDigests,
    )
  }
  if (gateId === 'promotion.canary_window') {
    return typedArtifactParse(
      parseCanaryWindowEvidence(content),
      true,
      canaryWindowDependencyDigests,
    )
  }
  if (gateId === 'promotion.restore_rollback') {
    return typedArtifactParse(
      parseRecoveryRehearsalEvidence(content),
      true,
      recoveryRehearsalDependencyDigests,
    )
  }

  const readbackGate = READBACK_GATE_BY_GATE_F_ID[gateId]
  if (readbackGate) {
    return typedArtifactParse(
      parsePromotionReadbackEvidence(content, readbackGate),
      true,
      promotionReadbackDependencyDigests,
    )
  }

  if (Object.hasOwn(LIVE_EVIDENCE_PARSERS, gateId)) {
    const parsed = LIVE_EVIDENCE_PARSERS[gateId as LiveEvidenceGateId](content)
    return parsed.ok
      ? {
          facts: parsed.evidence,
          errors: [],
          dependencyDigests: parsed.dependencyDigests,
          checkRetention: true,
        }
      : { errors: parsed.errors, dependencyDigests: [], checkRetention: true }
  }

  return undefined
}

/**
 * Dispatch one referenced artifact to its producer's parser.
 *
 * `undefined` means the label has no typed producer. After REL-01-T6 that is
 * true only for the manifest, the signature bundle, the findings register, the
 * approval envelopes (handled separately, because they need the decision
 * digest and a signature verifier) and the secondary dependency artifacts a
 * gate retains alongside its primary proof.
 */
function parseTypedArtifact(
  label: string,
  content: string,
  options: GateFValidationOptions,
): TypedArtifactParse | undefined {
  const releaseArtifact = parseReleaseArtifact(label, content, options)
  if (releaseArtifact) return releaseArtifact

  const gateMatch = /^gates\.(.+)\.evidence\.0$/u.exec(label)
  if (!gateMatch) return undefined
  return parseGateArtifact(gateMatch[1] ?? '', content)
}

function validateTypedPromotionArtifact(input: {
  label: string
  content: string
  referencedAt: string
  completedAt: string
  candidate: ReleaseCandidateBinding
  retainedDigests: ReadonlySet<string>
  options: GateFValidationOptions
}): readonly string[] {
  const parsed = parseTypedArtifact(input.label, input.content, input.options)
  if (!parsed) return []
  if (!parsed.facts) return parsed.errors.map((error) => `${input.label}: ${error}`)
  const facts = parsed.facts
  const errors = candidateBindingErrors(facts.candidate, input.candidate).map(
    (error) => `${input.label}: ${error}`,
  )
  if (parsed.checkRetention) {
    for (const digest of new Set(parsed.dependencyDigests)) {
      if (!input.retainedDigests.has(digest)) {
        errors.push(`${input.label}: dependency ${digest} is not retained by this gate`)
      }
    }
  }
  if (facts.outcome !== 'passed') {
    errors.push(`${input.label}: typed promotion evidence did not pass`)
  }
  if (Date.parse(input.referencedAt) < Date.parse(facts.capturedAt)) {
    errors.push(`${input.label}: Gate F reference predates artifact capture`)
  }
  // A proof that had already expired when Gate F completed is not a proof for
  // this release; it is last month's receipt carried forward.
  if (
    facts.expiresAt !== undefined &&
    Date.parse(facts.expiresAt) < Date.parse(input.completedAt)
  ) {
    errors.push(
      `${input.label}: evidence expired at ${facts.expiresAt}, before Gate F completed at ${input.completedAt}`,
    )
  }
  return errors
}

/**
 * Approval envelopes are validated separately from the other artifacts: they
 * are the only ones that must bind the Gate F DECISION digest and carry a
 * verified signature, and the only ones where a missing verifier is itself a
 * rejection.
 */
function validateApprovalEnvelope(input: {
  label: string
  content: string
  approval: GateFEvidence['approvals'][number]
  legalRevisionSetSha256: string
  decisionSha256: string
  verifyApproval: GateFApprovalVerifier | undefined
}): readonly string[] {
  const parsed = parseGateFApprovalEnvelope(input.content)
  if (!parsed.ok) return parsed.errors.map((error) => `${input.label}: ${error}`)
  const envelope = parsed.envelope
  const errors: string[] = []
  if (envelope.role !== input.approval.role) {
    errors.push(
      `${input.label}: envelope role ${envelope.role} does not match the indexed approval role ${input.approval.role}`,
    )
  }
  if (envelope.approverIdentity !== input.approval.approverIdentity) {
    errors.push(`${input.label}: envelope approver does not match the indexed approval`)
  }
  if (envelope.approvedAt !== input.approval.approvedAt) {
    errors.push(`${input.label}: envelope approval time does not match the index`)
  }
  if (envelope.releaseManifestSha256 !== input.approval.releaseManifestSha256) {
    errors.push(`${input.label}: envelope does not bind the release manifest digest`)
  }
  if (envelope.legalRevisionSetSha256 !== input.legalRevisionSetSha256) {
    errors.push(`${input.label}: envelope does not bind the legal revision-set digest`)
  }
  if (envelope.gateFDecisionSha256 !== input.decisionSha256) {
    errors.push(
      `${input.label}: envelope signs Gate F decision ${envelope.gateFDecisionSha256}, not this decision ${input.decisionSha256}`,
    )
  }
  if (!input.verifyApproval) {
    // No verifier means CLOSED, not skipped. An unverifiable approval is
    // indistinguishable from a forged one.
    errors.push(
      `${input.label}: no approval signature verifier was supplied; Gate F approvals cannot be accepted unverified`,
    )
    return errors
  }
  const verification = input.verifyApproval(envelope)
  if (!verification.ok) {
    errors.push(`${input.label}: ${verification.code}: ${verification.message}`)
  }
  return errors
}

export type GateFValidationOptions = Readonly<{
  /** Fail-closed Ed25519 role verifier (REL-01-T7). Absent means rejected. */
  verifyApproval?: GateFApprovalVerifier
  legalRevisionSet?: LegalRevisionSetContext
  /** Reader for the on-disk legal documents (REL-01-T8). Absent means rejected. */
  legalDocuments?: LegalApprovalChecklistContext
}>

/**
 * Validate the canonical index plus every byte-bound evidence reference.
 * `readEvidence` owns root containment; the repository CLI supplies a
 * path-contained implementation.
 *
 * `options.legalRevisionSet` defaults to the SHIPPED legal document registry,
 * which is the honest default: while every counsel-owned row is a draft, no
 * Gate F bundle can validate. It is injectable for the same reason
 * `legal-approval-authority.ts` injects its reader — the rules have to be
 * exercisable against a hypothetically-approved registry.
 *
 * `options.verifyApproval` and `options.legalDocuments` are NOT optional in
 * effect. Omitting either is a rejection, not a skip: an approval nobody can
 * verify and a legal document nobody re-hashed are exactly the two fail-opens
 * REL-01-T7 and REL-01-T8 exist to close.
 */
type ReferencedArtifactScan = Readonly<{
  errors: readonly string[]
  /** Retained so the two release-level cross-checks can re-read the bytes. */
  manifestContent: string | undefined
  legalChecklistContent: string | undefined
}>

/**
 * Read, digest-check and validate every artifact the index references. A digest
 * that does not match, or bytes that cannot be read, stops that reference — the
 * remaining references are still checked so one bad file does not hide others.
 */
function scanReferencedArtifacts(
  evidence: GateFEvidence,
  readEvidence: (path: string) => Uint8Array,
  options: GateFValidationOptions,
): ReferencedArtifactScan {
  const errors: string[] = []
  const observedByPath = new Map<string, string>()
  let manifestContent: string | undefined
  let legalChecklistContent: string | undefined
  const retainedGateDigests = new Map(
    evidence.gates.map((gate) => [
      `gates.${gate.id}.evidence.0`,
      new Set(gate.evidence.map(({ sha256 }) => sha256)),
    ]),
  )
  const expectedCandidate: ReleaseCandidateBinding = {
    releaseSha: evidence.release.releaseSha,
    releaseManifestSha256: evidence.release.manifest.sha256,
    cell: evidence.release.cell,
    environment: evidence.release.environment,
    deploymentProfile: evidence.release.deploymentProfile,
    projectName: evidence.release.projectName,
    projectId: evidence.release.projectId,
    environmentId: evidence.release.environmentId,
    appOrigin: evidence.release.appOrigin,
  }
  const decisionSha256 = gateFDecisionSha256(evidence)
  const approvalsByLabel = new Map(
    evidence.approvals.map((approval) => [
      `approvals.${approval.role}.evidence`,
      approval,
    ]),
  )
  for (const { label, reference } of evidenceReferences(evidence)) {
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
    const utf8 = Buffer.from(payload).toString('utf8')
    const approval = approvalsByLabel.get(label)
    if (approval) {
      errors.push(
        ...validateApprovalEnvelope({
          label,
          content: utf8,
          approval,
          legalRevisionSetSha256: evidence.release.legalRevisionSet.sha256,
          decisionSha256,
          verifyApproval: options.verifyApproval,
        }),
      )
    } else {
      errors.push(
        ...validateTypedPromotionArtifact({
          label,
          content: utf8,
          referencedAt: reference.capturedAt,
          completedAt: evidence.completedAt,
          candidate: expectedCandidate,
          retainedDigests: retainedGateDigests.get(label) ?? new Set<string>(),
          options,
        }),
      )
    }
    if (label === 'release.manifest') manifestContent = utf8
    if (label === 'release.legalApprovalChecklist') legalChecklistContent = utf8
  }
  return { errors, manifestContent, legalChecklistContent }
}

/** The checklist must decide the same legal revision set the bundle binds. */
function legalChecklistBindingErrors(
  content: string,
  legalRevisionSetSha256: string,
  options: GateFValidationOptions,
): readonly string[] {
  const checklist = parseLegalApprovalChecklist(content, options.legalDocuments)
  return checklist.ok &&
    checklist.evidence.legalRevisionSetSha256 !== legalRevisionSetSha256
    ? [
        'release.legalApprovalChecklist: checklist does not decide the legal revision set this bundle binds',
      ]
    : []
}

/** The retained manifest bytes must agree with the Gate F index that cites them. */
function manifestConsistencyErrors(
  content: string,
  evidence: GateFEvidence,
): readonly string[] {
  const manifest = parsePromotionManifest(content)
  if (!manifest.ok) return [`release.manifest: ${manifest.errors.join('; ')}`]

  const errors: string[] = []
  if (manifest.digest !== evidence.release.manifest.sha256) {
    errors.push('release.manifest: parsed digest does not match its evidence ref')
  }
  if (manifest.manifest.releaseSha !== evidence.release.releaseSha) {
    errors.push('release.manifest: release SHA does not match Gate F index')
  }
  if (
    Date.parse(evidence.release.manifest.capturedAt) <
    Date.parse(manifest.manifest.createdAt)
  ) {
    errors.push('release.manifest: evidence capture predates manifest creation')
  }
  if (
    Date.parse(evidence.release.signatureBundle.capturedAt) <
    Date.parse(manifest.manifest.createdAt)
  ) {
    errors.push('release.signatureBundle: capture predates manifest creation')
  }
  if (manifest.manifest.cells.length !== 1 || manifest.manifest.cells[0] !== 'us') {
    errors.push('release.manifest: beta manifest must contain only us')
  }
  return errors
}

export function validateGateFEvidenceBundle(
  content: string,
  readEvidence: (path: string) => Uint8Array,
  options: GateFValidationOptions = {},
): GateFEvidenceValidationResult {
  const parsed = parseGateFEvidence(content)
  if (!parsed.ok) return parsed

  const scan = scanReferencedArtifacts(parsed.evidence, readEvidence, options)
  const errors: string[] = [...scan.errors]

  if (scan.legalChecklistContent !== undefined) {
    errors.push(
      ...legalChecklistBindingErrors(
        scan.legalChecklistContent,
        parsed.evidence.release.legalRevisionSet.sha256,
        options,
      ),
    )
  }

  if (scan.manifestContent) {
    errors.push(...manifestConsistencyErrors(scan.manifestContent, parsed.evidence))
  }

  return errors.length === 0
    ? { ok: true, evidence: parsed.evidence, digest: parsed.digest }
    : { ok: false, errors }
}
