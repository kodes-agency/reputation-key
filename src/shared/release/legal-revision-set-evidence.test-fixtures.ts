/**
 * Shared fixture for the legal revision set (LEG-01).
 *
 * The shipped registry is entirely candidate drafts — that is the state the
 * gate exists to refuse — so every POSITIVE assertion has to run against a
 * hypothetical registry in which counsel has actually signed. Building that
 * registry once, here, keeps `legal-revision-set-evidence.test.ts` and
 * `gate-f-evidence.test.ts` asserting over the same shape, and keeps the
 * approver identity in one place so it can never drift into something the
 * self-approval rule would have to catch.
 */

import { LEGAL_PUBLICATION_DOCUMENT_IDS } from '../governance/legal-approval-authority'
import {
  LEGAL_DOCUMENT_REGISTRY,
  LEGAL_DOCUMENT_REGISTRY_PATH,
  canonicalLegalDocumentRegistry,
  legalDocumentSha256,
  type LegalApprover,
  type LegalDocumentRegistry,
} from '../governance/legal-document-registry'
import { IN_PRODUCT_NOTICES } from '../governance/legal-link-targets'
import type { ReleaseCandidateBinding } from './candidate-bound-evidence'
import {
  LEGAL_REVISION_SET_EVIDENCE_VERSION,
  canonicalLegalRevisionSetEvidence,
  requiredLegalRevisionSetDocumentIds,
  type LegalRevisionSetContext,
  type LegalRevisionSetEvidence,
} from './legal-revision-set-evidence'

export const LEGAL_FIXTURE_COUNSEL: LegalApprover = Object.freeze({
  name: 'Ada Lovelace-Marín',
  role: 'external_counsel',
  organization: 'Marín & Partners LLP',
})

export const LEGAL_FIXTURE_APPROVAL_DATES = Object.freeze({
  effectiveFrom: '2026-08-01',
  reviewDueOn: '2027-02-01',
  expiresOn: '2027-08-01',
  approvedAt: '2026-07-31T10:00:00.000Z',
})

export const LEGAL_FIXTURE_CAPTURED_AT = '2026-08-28T10:00:00.000Z'

/**
 * Approved Markdown carries neither non-publishable marker; draft Markdown
 * carries both. `legal-approval-authority.ts` checks for exactly that, in
 * both directions, so the fixture bodies have to be real enough to satisfy it
 * — the fixture registry cannot claim an approval over bytes that still say
 * "do not publish".
 */
const approvedBody = (title: string, version: string): string =>
  `# ${title}\n\n**Status:** Approved\n**Version:** ${version}\n**Effective from:** ${LEGAL_FIXTURE_APPROVAL_DATES.effectiveFrom}\n`

const draftBody = (title: string): string =>
  `# ${title}\n\n**Status:** Candidate draft — do not publish.\n`

export type LegalDocumentsFixture = Readonly<{
  registry: LegalDocumentRegistry
  /** Repository-relative document bytes the registry digests were taken over. */
  files: ReadonlyMap<string, Uint8Array>
}>

/**
 * The shipped registry with every counsel row promoted to `approved`, the
 * in-product notices added as rows, and a matching set of document bytes.
 * Digests are never invented: the counsel digests are taken over the fixture
 * bodies, and the notice digests come from the frozen copy the product
 * actually renders.
 */
export function approvedLegalDocumentsFixture(): LegalDocumentsFixture {
  const shipped = new Map(
    LEGAL_DOCUMENT_REGISTRY.documents.map((document) => [document.id, document]),
  )
  const files = new Map<string, Uint8Array>()
  const encoder = new TextEncoder()

  const counselRows = LEGAL_PUBLICATION_DOCUMENT_IDS.map((id) => {
    const source = shipped.get(id)
    if (source === undefined) throw new Error(`shipped registry is missing ${id}`)
    const body = approvedBody(source.title, '2.0')
    files.set(source.path, encoder.encode(body))
    return {
      ...source,
      version: '2.0',
      status: 'approved' as const,
      sha256: legalDocumentSha256(body),
      ...LEGAL_FIXTURE_APPROVAL_DATES,
      approver: LEGAL_FIXTURE_COUNSEL,
      approvalEvidenceRef: `docs/legal/approvals/${id}.json`,
    }
  })

  const noticeRows = IN_PRODUCT_NOTICES.map((notice) => ({
    id: notice.id,
    kind: notice.kind,
    title: notice.title,
    path: notice.source,
    version: notice.version,
    status: 'approved' as const,
    sha256: notice.sha256,
    ...LEGAL_FIXTURE_APPROVAL_DATES,
    approver: LEGAL_FIXTURE_COUNSEL,
    approvalEvidenceRef: `docs/legal/approvals/${notice.id}.json`,
  }))

  const shippedFactMap = shipped.get('implementation-facts')
  if (shippedFactMap === undefined) {
    throw new Error('shipped registry is missing the fact map')
  }
  const factMapBody = draftBody(shippedFactMap.title)
  files.set(shippedFactMap.path, encoder.encode(factMapBody))
  const factMap = { ...shippedFactMap, sha256: legalDocumentSha256(factMapBody) }

  return {
    registry: {
      version: LEGAL_DOCUMENT_REGISTRY.version,
      updatedAt: LEGAL_DOCUMENT_REGISTRY.updatedAt,
      documents: [...counselRows, ...noticeRows, factMap].sort((left, right) =>
        left.id < right.id ? -1 : 1,
      ),
    },
    files,
  }
}

export function approvedLegalDocumentRegistryFixture(): LegalDocumentRegistry {
  return approvedLegalDocumentsFixture().registry
}

export function legalDocumentReaderFixture(
  files: ReadonlyMap<string, Uint8Array>,
): (path: string) => Uint8Array {
  return (path) => {
    const bytes = files.get(path)
    if (bytes === undefined) throw new Error(`no fixture document at ${path}`)
    return bytes
  }
}

export function legalRevisionSetContextFixture(
  registry: LegalDocumentRegistry = approvedLegalDocumentRegistryFixture(),
): LegalRevisionSetContext {
  return { registry, inProductNotices: IN_PRODUCT_NOTICES }
}

export function legalRevisionSetFixture(
  candidate: ReleaseCandidateBinding,
  context: LegalRevisionSetContext = legalRevisionSetContextFixture(),
  overrides: Partial<LegalRevisionSetEvidence> = {},
): LegalRevisionSetEvidence {
  const byId = new Map(context.registry.documents.map((row) => [row.id, row]))
  return {
    version: LEGAL_REVISION_SET_EVIDENCE_VERSION,
    evidenceKind: 'legal-revision-set',
    candidate,
    cell: 'us',
    environment: 'cell-us',
    capturedAt: LEGAL_FIXTURE_CAPTURED_AT,
    registry: {
      path: LEGAL_DOCUMENT_REGISTRY_PATH,
      sha256: legalDocumentSha256(canonicalLegalDocumentRegistry(context.registry)),
    },
    documents: requiredLegalRevisionSetDocumentIds(context).map((id) => {
      const row = byId.get(id)
      if (row === undefined) throw new Error(`fixture registry is missing ${id}`)
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        path: row.path,
        version: row.version,
        status: row.status,
        sha256: row.sha256,
        effectiveFrom: row.effectiveFrom ?? LEGAL_FIXTURE_APPROVAL_DATES.effectiveFrom,
        reviewDueOn: row.reviewDueOn ?? LEGAL_FIXTURE_APPROVAL_DATES.reviewDueOn,
        expiresOn: row.expiresOn ?? LEGAL_FIXTURE_APPROVAL_DATES.expiresOn,
        approvedAt: row.approvedAt ?? LEGAL_FIXTURE_APPROVAL_DATES.approvedAt,
        approver: row.approver ?? LEGAL_FIXTURE_COUNSEL,
        approvalEvidenceRef: row.approvalEvidenceRef ?? `docs/legal/approvals/${id}.json`,
      }
    }),
    outcome: 'passed',
    failures: [],
    ...overrides,
  }
}

export function legalRevisionSetFixtureContent(
  candidate: ReleaseCandidateBinding,
  context: LegalRevisionSetContext = legalRevisionSetContextFixture(),
  overrides: Partial<LegalRevisionSetEvidence> = {},
): string {
  return canonicalLegalRevisionSetEvidence(
    legalRevisionSetFixture(candidate, context, overrides),
  )
}
