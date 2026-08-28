/**
 * Typed release legal revision set (LEG-01) — the artifact that closes the
 * Gate F fail-open.
 *
 * The rule enforced here: **no external beta before counsel approval, bound
 * to the exact bytes counsel approved, for this exact release candidate.**
 *
 * Gate F already required a `release.legalRevisionSet` reference and made
 * counsel and founder bind its digest. It never looked inside. Any bytes
 * satisfied it — the repository's own fixture passed
 * `{"privacy":"2026-08-28","terms":"2026-08-28"}` — so the strongest legal
 * control in the program was a file that existed. This module makes those
 * bytes a proof:
 *
 * - it carries the same `ReleaseCandidateBinding` as every other live
 *   promotion proof, so a revision set captured for another SHA, project, or
 *   environment cannot be relabelled;
 * - it must bind `cell-us` and nothing else, because beta is exactly one
 *   logical US Data Cell;
 * - every entry must be `approved`, and must be a faithful copy of its row in
 *   `docs/legal/legal-document-registry.json` — same digest, same version,
 *   same approver, same dates. A document edited after approval, or promoted
 *   in the artifact but not in the registry, fails;
 * - the registry reference must be self-consistent: its digest is taken over
 *   the canonical bytes of the very registry the entries are checked against;
 * - the set must be COMPLETE — the three counsel-owned documents plus every
 *   in-product notice — so a copy bump cannot ship outside the record;
 * - `effectiveFrom <= capturedAt < expiresOn` for each entry, so a lapsed
 *   approval cannot be carried forward into a later release;
 * - counsel-owned text must be approved by an `external_counsel` role, and no
 *   approver may be an identity in `LEGAL_SELF_APPROVAL_PROHIBITED`.
 *   Engineering can never self-approve a legal document.
 *
 * The registry is INJECTED (defaulting to the shipped one) for the same
 * reason `legal-approval-authority.ts` injects its reader: the rules must be
 * testable against a hypothetically-approved world while the real default
 * stays the one that is true today — where every counsel row is a draft and
 * therefore no revision set is representable at all.
 */

import { z } from 'zod/v4'
import {
  LEGAL_PUBLICATION_DOCUMENT_IDS,
  LEGAL_SELF_APPROVAL_PROHIBITED,
} from '../governance/legal-approval-authority'
import {
  LEGAL_APPROVER_ROLES,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_REGISTRY,
  LEGAL_DOCUMENT_REGISTRY_PATH,
  LEGAL_DOCUMENT_STATUSES,
  canonicalLegalDocumentRegistry,
  legalDocumentSha256,
  type LegalDocument,
  type LegalDocumentRegistry,
} from '../governance/legal-document-registry'
import {
  IN_PRODUCT_NOTICES,
  type InProductNotice,
} from '../governance/legal-link-targets'
import {
  canonicalReleaseEvidence,
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'

export const LEGAL_REVISION_SET_EVIDENCE_VERSION = 'repkey-legal-revision-set-1' as const

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)

/** Same containment discipline as the Gate F index and the registry itself. */
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

const approverSchema = z
  .object({
    name: releaseEvidenceIdentitySchema,
    role: z.enum(LEGAL_APPROVER_ROLES),
    organization: releaseEvidenceIdentitySchema,
  })
  .strict()

const revisionSetDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/u),
    kind: z.enum(LEGAL_DOCUMENT_KINDS),
    title: releaseEvidenceIdentitySchema,
    path: safeEvidencePath,
    version: z.string().trim().min(1).max(64),
    status: z.enum(LEGAL_DOCUMENT_STATUSES),
    sha256: releaseEvidenceSha256Schema,
    effectiveFrom: calendarDate,
    reviewDueOn: calendarDate,
    expiresOn: calendarDate,
    approvedAt: releaseEvidenceTimestampSchema,
    approver: approverSchema,
    approvalEvidenceRef: safeEvidencePath,
  })
  .strict()

export type LegalRevisionSetDocument = z.infer<typeof revisionSetDocumentSchema>

const legalRevisionSetBaseSchema = z
  .object({
    version: z.literal(LEGAL_REVISION_SET_EVIDENCE_VERSION),
    evidenceKind: z.literal('legal-revision-set'),
    candidate: releaseCandidateBindingSchema,
    // Deliberately NOT literals: a bundle that names another cell must fail
    // with the sentence that says why, not with a generic enum mismatch.
    cell: z.string().trim().min(1).max(64),
    environment: z.string().trim().min(1).max(64),
    capturedAt: releaseEvidenceTimestampSchema,
    registry: z
      .object({ path: safeEvidencePath, sha256: releaseEvidenceSha256Schema })
      .strict(),
    documents: z.array(revisionSetDocumentSchema).min(1),
    outcome: z.enum(['passed', 'failed']),
    failures: z.array(z.string().trim().min(1).max(1024)),
  })
  .strict()

export type LegalRevisionSetEvidence = z.infer<typeof legalRevisionSetBaseSchema>

export type LegalRevisionSetContext = Readonly<{
  registry: LegalDocumentRegistry
  inProductNotices: readonly InProductNotice[]
}>

export const DEFAULT_LEGAL_REVISION_SET_CONTEXT: LegalRevisionSetContext = Object.freeze({
  registry: LEGAL_DOCUMENT_REGISTRY,
  inProductNotices: IN_PRODUCT_NOTICES,
})

/**
 * The counsel-owned documents that gate external beta, plus every notice the
 * product renders itself. Sorted so there is exactly one canonical order.
 */
export function requiredLegalRevisionSetDocumentIds(
  context: LegalRevisionSetContext = DEFAULT_LEGAL_REVISION_SET_CONTEXT,
): readonly string[] {
  return [
    ...LEGAL_PUBLICATION_DOCUMENT_IDS,
    ...context.inProductNotices.map((notice) => notice.id),
  ].sort()
}

function isProhibitedIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return LEGAL_SELF_APPROVAL_PROHIBITED.some(
    (prohibited) => prohibited.toLowerCase() === normalized,
  )
}

/** Fields a revision-set entry must copy verbatim from its registry row. */
const REGISTRY_MIRRORED_FIELDS = [
  'kind',
  'title',
  'path',
  'version',
  'status',
  'effectiveFrom',
  'reviewDueOn',
  'expiresOn',
  'approvedAt',
  'approvalEvidenceRef',
] as const

function registryMismatchErrors(
  entry: LegalRevisionSetDocument,
  row: LegalDocument,
): readonly string[] {
  const errors = REGISTRY_MIRRORED_FIELDS.flatMap((field) =>
    entry[field] === row[field]
      ? []
      : [`document ${entry.id}: ${field} does not match the legal document registry`],
  )
  if (entry.sha256 !== row.sha256) {
    errors.push(`document ${entry.id}: digest does not match the legal document registry`)
  }
  if (
    row.approver === null ||
    entry.approver.name !== row.approver.name ||
    entry.approver.role !== row.approver.role ||
    entry.approver.organization !== row.approver.organization
  ) {
    errors.push(
      `document ${entry.id}: approver does not match the legal document registry`,
    )
  }
  return errors
}

function documentFailures(
  entry: LegalRevisionSetDocument,
  context: LegalRevisionSetContext,
  capturedOn: string,
): readonly string[] {
  const errors: string[] = []

  if (entry.status !== 'approved') {
    errors.push(
      `document ${entry.id} is a draft and cannot appear in a release legal revision set`,
    )
  }

  if (entry.kind === 'counsel_approved' && entry.approver.role !== 'external_counsel') {
    errors.push(`document ${entry.id} must be approved by external counsel`)
  }
  for (const identity of [entry.approver.name, entry.approver.organization]) {
    if (isProhibitedIdentity(identity)) {
      errors.push(`document ${entry.id}: approver ${identity} cannot self-approve`)
    }
  }

  if (entry.effectiveFrom > capturedOn) {
    errors.push(`document ${entry.id}: capture predates the approval effective date`)
  }
  if (entry.expiresOn <= capturedOn) {
    errors.push(`document ${entry.id}: approval expired before release capture`)
  }
  if (Date.parse(entry.approvedAt) > Date.parse(`${capturedOn}T23:59:59.999Z`)) {
    errors.push(`document ${entry.id}: approval recorded after release capture`)
  }

  const row = context.registry.documents.find((document) => document.id === entry.id)
  if (row === undefined) {
    errors.push(`document ${entry.id} is not registered in the legal document registry`)
    return errors
  }
  errors.push(...registryMismatchErrors(entry, row))

  // The in-product notices are pinned twice on purpose: once by the registry
  // row a human reviews, and once by the digest recomputed from the frozen
  // copy the product actually renders. A copy bump that updates only one of
  // them is the exact drift this artifact exists to catch.
  const notice = context.inProductNotices.find((candidate) => candidate.id === entry.id)
  if (notice !== undefined && entry.sha256 !== notice.sha256) {
    errors.push(`document ${entry.id}: digest does not match the shipped in-product copy`)
  }

  return errors
}

/**
 * Every reason this revision set is not a valid release proof. An empty list
 * is the only state in which `outcome: 'passed'` is representable.
 */
export function legalRevisionSetFailures(
  evidence: LegalRevisionSetEvidence,
  context: LegalRevisionSetContext = DEFAULT_LEGAL_REVISION_SET_CONTEXT,
): readonly string[] {
  const errors: string[] = []

  if (evidence.cell !== 'us' || evidence.environment !== 'cell-us') {
    errors.push('beta legal revision set must bind cell-us only')
  }
  if (
    evidence.cell !== evidence.candidate.cell ||
    evidence.environment !== evidence.candidate.environment
  ) {
    errors.push('legal revision set cell must match its release candidate binding')
  }

  if (evidence.registry.path !== LEGAL_DOCUMENT_REGISTRY_PATH) {
    errors.push(`registry: path must be ${LEGAL_DOCUMENT_REGISTRY_PATH}`)
  }
  const registryDigest = legalDocumentSha256(
    canonicalLegalDocumentRegistry(context.registry),
  )
  if (evidence.registry.sha256 !== registryDigest) {
    errors.push('registry: digest does not match the legal document registry bytes')
  }

  const ids = evidence.documents.map((document) => document.id)
  if (new Set(ids).size !== ids.length) {
    errors.push('duplicate legal document id in revision set')
  }
  for (const id of requiredLegalRevisionSetDocumentIds(context)) {
    if (!ids.includes(id)) errors.push(`missing required legal document ${id}`)
  }

  const capturedOn = evidence.capturedAt.slice(0, 10)
  for (const entry of evidence.documents) {
    errors.push(...documentFailures(entry, context, capturedOn))
  }

  return errors
}

/**
 * Mirrors recovery-rehearsal-evidence.ts: a passing outcome is only
 * representable when nothing failed, so the artifact cannot claim more than
 * it proves.
 */
function outcomeErrors(evidence: LegalRevisionSetEvidence): readonly string[] {
  if (evidence.outcome === 'passed' && evidence.failures.length !== 0) {
    return ['outcome: passed outcome requires an empty failure list']
  }
  if (evidence.outcome === 'failed' && evidence.failures.length === 0) {
    return ['failures: failed outcome requires at least one failure']
  }
  return []
}

export function canonicalLegalRevisionSetEvidence(
  evidence: LegalRevisionSetEvidence,
): string {
  return canonicalReleaseEvidence(evidence)
}

const LABEL = 'Legal revision set'

/**
 * Parsed by hand rather than through `parseCanonicalReleaseEvidence` for one
 * reason: the semantic failures already name the document they are about
 * (`document privacy-notice is a draft …`), and Gate F prefixes them again
 * with `release.legalRevisionSet`. A third `Legal revision set:` in front of
 * every line would bury the sentence a reviewer has to read. Shape, ordering
 * and the canonical-encoding message stay identical.
 */
export function parseLegalRevisionSetEvidence(
  content: string,
  context: LegalRevisionSetContext = DEFAULT_LEGAL_REVISION_SET_CONTEXT,
): CanonicalReleaseEvidenceParseResult<LegalRevisionSetEvidence> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: [`${LABEL} is not valid JSON`] }
  }
  const parsed = legalRevisionSetBaseSchema.safeParse(value)
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
  const errors = [
    ...legalRevisionSetFailures(parsed.data, context),
    ...outcomeErrors(parsed.data),
  ]
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    evidence: parsed.data,
    digest: releaseEvidenceSha256(canonical),
  }
}
