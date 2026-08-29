/**
 * The legal approval checklist (REL-01-T8) — the artifact that says counsel
 * DECIDED the LEG-01 facts, not merely that a legal file exists.
 *
 * This builds on `legal-revision-set-evidence.ts` (LEG-01, wave 2) instead of
 * duplicating it. The revision set proves *which bytes* counsel approved and
 * that they match the registry. It cannot prove that those bytes RESOLVE the
 * open questions in `docs/legal/counsel-decision-checklist.json`: a privacy
 * notice can be approved, current, and digest-matched while the transfer
 * mechanism, the retention classes, and the Google confirmation expiry are all
 * still open. Gate F would have passed on it.
 *
 * So this artifact carries three things the revision set does not:
 *
 * 1. every required LEG-01 fact key, each with `decided: true`, a decision
 *    sentence, a decider and a decision date. A missing key and an undecided
 *    key are both rejections — there is no "assumed" state;
 * 2. the on-disk digest of each counsel-owned document, checked against the
 *    bytes in this checkout, so a post-approval edit invalidates the approval
 *    instead of silently inheriting it;
 * 3. an approval window. `approvedAt` must fall inside
 *    `[effectiveAt, expiresAt]`, and Gate F separately refuses a checklist
 *    whose `expiresAt` precedes `completedAt` — a stale approval is not an
 *    approval.
 *
 * The document reader is INJECTED. `src/shared/release` must not reach the
 * filesystem (it is compiled with the application), and a checklist that
 * cannot verify its digests must fail CLOSED rather than trust its own
 * numbers.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  canonicalReleaseEvidence,
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'

export const LEGAL_APPROVAL_CHECKLIST_VERSION =
  'repkey-legal-approval-checklist-1' as const

/** The counsel-owned documents that gate external beta, in publication order. */
export const LEGAL_CHECKLIST_DOCUMENTS = [
  { documentId: 'privacy-notice', path: 'docs/legal/privacy-notice.md' },
  {
    documentId: 'internal-beta-agreement',
    path: 'docs/legal/internal-beta-agreement.md',
  },
  {
    documentId: 'google-access-disclosure',
    path: 'docs/legal/google-access-disclosure.md',
  },
] as const

/**
 * Every LEG-01 fact counsel must decide before an external beta opens, and the
 * `docs/legal/counsel-decision-checklist.json` category it is sourced from.
 * A fact with no decision blocks the release; there is no default.
 */
export const LEG_01_REQUIRED_FACT_KEYS = [
  'beta_support_commitment',
  'controller_processor_roles',
  'data_subject_rights',
  'dpia_ccpa_decision',
  'employee_metrics_framing',
  'google_confirmation_conditions',
  'google_confirmation_expiry',
  'google_confirmation_monitoring_owner',
  'google_confirmation_scope',
  'lawful_bases',
  'regions_and_transfers',
  'retention_classes',
  'subprocessors',
] as const
export type Leg01FactKey = (typeof LEG_01_REQUIRED_FACT_KEYS)[number]

export const LEG_01_FACT_SOURCE_CATEGORIES = {
  beta_support_commitment: 'support_terms',
  controller_processor_roles: 'roles',
  data_subject_rights: 'rights',
  dpia_ccpa_decision: 'dpia_and_regions',
  employee_metrics_framing: 'staff_metrics',
  google_confirmation_conditions: 'google_terms_and_expiry',
  google_confirmation_expiry: 'google_terms_and_expiry',
  google_confirmation_monitoring_owner: 'google_terms_and_expiry',
  google_confirmation_scope: 'google_terms_and_expiry',
  lawful_bases: 'lawful_bases',
  regions_and_transfers: 'processors_and_transfers',
  retention_classes: 'retention_classes',
  subprocessors: 'processors_and_transfers',
} as const satisfies Readonly<Record<Leg01FactKey, string>>

/**
 * Markers a candidate draft carries. An approved checklist that still ships a
 * document containing one of these is approving a draft.
 */
const LEGAL_DRAFT_MARKERS: readonly RegExp[] = Object.freeze([
  /Candidate draft/u,
  /do not publish/iu,
  /not for publication/iu,
])

const calendarOrInstant = releaseEvidenceTimestampSchema

const checklistDocumentSchema = z
  .object({
    documentId: z.enum(
      LEGAL_CHECKLIST_DOCUMENTS.map(({ documentId }) => documentId) as [
        string,
        ...string[],
      ],
    ),
    path: z.string().trim().min(1).max(512),
    versionId: z.string().trim().min(1).max(64),
    sha256: releaseEvidenceSha256Schema,
    effectiveAt: calendarOrInstant,
    reviewAt: calendarOrInstant,
    expiresAt: calendarOrInstant,
  })
  .strict()

const checklistFactSchema = z
  .object({
    key: z.enum(LEG_01_REQUIRED_FACT_KEYS),
    decided: z.boolean(),
    decision: z.string().trim().min(1).max(2048),
    decidedBy: releaseEvidenceIdentitySchema,
    decidedAt: releaseEvidenceTimestampSchema,
    sourceDocumentId: z.string().trim().min(1).max(64),
    checklistItemIds: z.array(z.string().trim().min(1).max(128)).min(1),
  })
  .strict()

const legalApprovalChecklistSchema = z
  .object({
    version: z.literal(LEGAL_APPROVAL_CHECKLIST_VERSION),
    evidenceKind: z.literal('legal-approval-checklist'),
    candidate: releaseCandidateBindingSchema,
    capturedAt: releaseEvidenceTimestampSchema,
    /** Binds the LEG-01 revision set this checklist decides. */
    legalRevisionSetSha256: releaseEvidenceSha256Schema,
    counselIdentity: releaseEvidenceIdentitySchema,
    counselOrganization: releaseEvidenceIdentitySchema,
    approvedAt: releaseEvidenceTimestampSchema,
    effectiveAt: releaseEvidenceTimestampSchema,
    expiresAt: releaseEvidenceTimestampSchema,
    documents: z.array(checklistDocumentSchema).min(LEGAL_CHECKLIST_DOCUMENTS.length),
    facts: z.array(checklistFactSchema).min(LEG_01_REQUIRED_FACT_KEYS.length),
    outcome: z.enum(['passed', 'failed']),
    failures: z.array(z.string().trim().min(1).max(1024)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === 'passed' && value.failures.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires an empty failure list',
      })
    }
    if (value.outcome === 'failed' && value.failures.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'failed outcome requires at least one failure',
      })
    }

    const documentIds = value.documents.map(({ documentId }) => documentId)
    if (new Set(documentIds).size !== documentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'duplicate legal document id',
      })
    }
    for (const required of LEGAL_CHECKLIST_DOCUMENTS) {
      const entry = value.documents.find(
        (document) => document.documentId === required.documentId,
      )
      if (!entry) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: `missing required legal document ${required.documentId}`,
        })
        continue
      }
      if (entry.path !== required.path) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: `document ${required.documentId} must be ${required.path}`,
        })
      }
      if (Date.parse(entry.expiresAt) <= Date.parse(entry.effectiveAt)) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: `document ${required.documentId}: expiry must postdate the effective date`,
        })
      }
    }

    const factKeys = value.facts.map(({ key }) => key)
    if (new Set(factKeys).size !== factKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'duplicate LEG-01 fact key',
      })
    }
    for (const key of LEG_01_REQUIRED_FACT_KEYS) {
      const fact = value.facts.find((entry) => entry.key === key)
      if (!fact) {
        context.addIssue({
          code: 'custom',
          path: ['facts'],
          message: `missing required LEG-01 fact ${key}`,
        })
        continue
      }
      if (!fact.decided) {
        context.addIssue({
          code: 'custom',
          path: ['facts'],
          message: `LEG-01 fact ${key} is undecided`,
        })
      }
      if (Date.parse(fact.decidedAt) > Date.parse(value.approvedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['facts'],
          message: `LEG-01 fact ${key} was decided after counsel approval`,
        })
      }
    }

    const approvedAt = Date.parse(value.approvedAt)
    if (
      approvedAt < Date.parse(value.effectiveAt) ||
      approvedAt > Date.parse(value.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approvedAt'],
        message: 'counsel approval falls outside the [effectiveAt, expiresAt] window',
      })
    }
    if (Date.parse(value.capturedAt) < approvedAt) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture predates counsel approval',
      })
    }
  })

export type LegalApprovalChecklist = z.infer<typeof legalApprovalChecklistSchema>

export type LegalApprovalChecklistContext = Readonly<{
  /** Repository-relative reader; throws when the document is absent. */
  readDocument: (path: string) => Uint8Array
}>

export function canonicalLegalApprovalChecklist(value: LegalApprovalChecklist): string {
  return canonicalReleaseEvidence(value)
}

function documentDigestErrors(
  value: LegalApprovalChecklist,
  context: LegalApprovalChecklistContext,
): readonly string[] {
  const errors: string[] = []
  for (const document of value.documents) {
    let bytes: Uint8Array
    try {
      bytes = context.readDocument(document.path)
    } catch {
      errors.push(`document ${document.documentId}: cannot be read at ${document.path}`)
      continue
    }
    const onDisk = createHash('sha256').update(bytes).digest('hex')
    if (onDisk !== document.sha256) {
      errors.push(
        `document ${document.documentId}: on-disk digest ${onDisk} does not match the approved ${document.sha256}; the text changed after approval`,
      )
    }
    const body = Buffer.from(bytes).toString('utf8')
    const marker = LEGAL_DRAFT_MARKERS.find((pattern) => pattern.test(body))
    if (marker) {
      errors.push(
        `document ${document.documentId}: still carries a draft marker (${marker.source}) and cannot be approved for publication`,
      )
    }
  }
  return errors
}

const LABEL = 'Legal approval checklist'

/**
 * `context` is REQUIRED in effect: without a reader the on-disk digests
 * cannot be checked, and an approval whose documents may have changed since
 * approval is not an approval. Absence is a rejection, not a skip.
 */
export function parseLegalApprovalChecklist(
  content: string,
  context?: LegalApprovalChecklistContext,
): CanonicalReleaseEvidenceParseResult<LegalApprovalChecklist> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: [`${LABEL} is not valid JSON`] }
  }
  const parsed = legalApprovalChecklistSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || LABEL}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalReleaseEvidence(parsed.data)
  if (canonical !== content) {
    return { ok: false, errors: [`${LABEL} must use canonical JSON encoding`] }
  }
  if (context === undefined) {
    return {
      ok: false,
      errors: [
        `${LABEL}: on-disk legal document digests cannot be verified without a document reader`,
      ],
    }
  }
  const errors = documentDigestErrors(parsed.data, context)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    evidence: parsed.data,
    digest: releaseEvidenceSha256(canonical),
  }
}
