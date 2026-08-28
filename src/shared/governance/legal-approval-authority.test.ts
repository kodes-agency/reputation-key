import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_DOCUMENT_REGISTRY,
  type LegalDocument,
  type LegalDocumentRegistry,
} from './legal-document-registry'
import {
  LEGAL_SELF_APPROVAL_PROHIBITED,
  legalPublicationBlockers,
  requireApprovedLegalDocument,
  validateLegalDocumentRegistry,
} from './legal-approval-authority'

const DRAFT_BODY = '# Privacy Notice\n\n**Status:** Candidate draft — do not publish.\n'
const APPROVED_BODY = '# Privacy Notice\n\n**Effective from:** 2026-09-01\n'

const NOW = new Date('2026-09-15T00:00:00.000Z')

const digestOf = (body: string): string => createHash('sha256').update(body).digest('hex')

const bytesOf = (body: string): Uint8Array => new TextEncoder().encode(body)

const draft = (overrides: Partial<LegalDocument> = {}): LegalDocument => ({
  id: 'privacy-notice',
  kind: 'counsel_approved',
  title: 'Privacy Notice',
  path: 'docs/legal/privacy-notice.md',
  version: '2.0-draft',
  status: 'draft',
  sha256: digestOf(DRAFT_BODY),
  effectiveFrom: null,
  reviewDueOn: null,
  expiresOn: null,
  approvedAt: null,
  approver: null,
  approvalEvidenceRef: null,
  ...overrides,
})

const approved = (overrides: Partial<LegalDocument> = {}): LegalDocument =>
  draft({
    version: '2.0',
    status: 'approved',
    sha256: digestOf(APPROVED_BODY),
    effectiveFrom: '2026-09-01',
    reviewDueOn: '2027-03-01',
    expiresOn: '2027-09-01',
    approvedAt: '2026-08-31T10:00:00.000Z',
    approver: {
      name: 'Dana Counsel',
      role: 'external_counsel',
      organization: 'Firm LLP',
    },
    approvalEvidenceRef: 'docs/release-evidence/legal/privacy-notice-approval.json',
    ...overrides,
  })

const registryOf = (...documents: readonly LegalDocument[]): LegalDocumentRegistry => ({
  version: 'repkey-legal-document-registry-1',
  updatedAt: '2026-08-28',
  documents: [...documents],
})

function validate(
  documents: readonly LegalDocument[],
  bodies: Readonly<Record<string, string>>,
  now: Date = NOW,
): readonly string[] {
  const result = validateLegalDocumentRegistry({
    registry: registryOf(...documents),
    readDocument: (path) => {
      const body = bodies[path]
      if (body === undefined) throw new Error(`ENOENT: ${path}`)
      return bytesOf(body)
    },
    now,
  })
  return result.ok ? [] : result.errors
}

const PRIVACY = 'docs/legal/privacy-notice.md'

describe('legal approval authority', () => {
  it('accepts a draft whose recorded digest still matches the file on disk', () => {
    const result = validateLegalDocumentRegistry({
      registry: registryOf(draft()),
      readDocument: () => bytesOf(DRAFT_BODY),
      now: NOW,
    })

    expect(result).toEqual({
      ok: true,
      blockers: ['privacy-notice', 'internal-beta-agreement', 'google-access-disclosure'],
    })
  })

  it('fails an approved document whose bytes changed after approval', () => {
    const changed = `${APPROVED_BODY}A later unapproved sentence.\n`

    const errors = validate([approved()], { [PRIVACY]: changed })

    expect(errors).toContain(
      `privacy-notice: approved document changed after approval (registry ${digestOf(APPROVED_BODY)}, file ${digestOf(changed)})`,
    )
  })

  it('fails a draft whose recorded digest is stale', () => {
    const edited = `${DRAFT_BODY}An edit counsel has not seen.\n`

    const errors = validate([draft()], { [PRIVACY]: edited })

    expect(errors).toContain(
      `privacy-notice: draft document digest is stale (registry ${digestOf(DRAFT_BODY)}, file ${digestOf(edited)})`,
    )
  })

  it('fails when a registered document cannot be read at all', () => {
    const errors = validate([draft()], {})

    expect(errors).toContain(
      'privacy-notice: legal document cannot be read at docs/legal/privacy-notice.md',
    )
  })

  it('refuses to claim approval for a document the registry calls a draft', () => {
    expect(() => requireApprovedLegalDocument('privacy-notice')).toThrow(
      /privacy-notice.*not approved/u,
    )
    expect(() => requireApprovedLegalDocument('no-such-document')).toThrow(
      /no-such-document/u,
    )
  })

  it('returns the approved document once counsel has signed it', () => {
    expect(
      requireApprovedLegalDocument('privacy-notice', registryOf(approved())).id,
    ).toBe('privacy-notice')
  })

  it('names every counsel-owned document that still blocks publication', () => {
    expect(legalPublicationBlockers()).toEqual([
      'privacy-notice',
      'internal-beta-agreement',
      'google-access-disclosure',
    ])
    expect(legalPublicationBlockers(registryOf(approved()))).toEqual([
      'internal-beta-agreement',
      'google-access-disclosure',
    ])
  })

  it('rejects an approved document that still carries non-publishable markers', () => {
    for (const body of [
      '# Privacy Notice\n\n**Status:** Candidate draft\n',
      '# Privacy Notice\n\n> Do not publish this draft.\n',
    ]) {
      const errors = validate([approved({ sha256: digestOf(body) })], {
        [PRIVACY]: body,
      })

      expect(errors).toContain(
        'privacy-notice: approved document still carries non-publishable markers',
      )
    }
  })

  it('rejects a draft that has quietly lost its non-publishable markers', () => {
    const errors = validate([draft({ sha256: digestOf(APPROVED_BODY) })], {
      [PRIVACY]: APPROVED_BODY,
    })

    expect(errors).toContain(
      'privacy-notice: draft document is missing its non-publishable marker',
    )
  })

  it('refuses engineering self-approval of a counsel-owned document', () => {
    expect(LEGAL_SELF_APPROVAL_PROHIBITED).toContain('Bozhidar Denev')

    const wrongRole = approved({
      approver: {
        name: 'Dana Counsel',
        role: 'engineering',
        organization: 'Firm LLP',
      },
    })
    const prohibitedName = approved({
      approver: {
        name: 'Bozhidar Denev',
        role: 'external_counsel',
        organization: 'Firm LLP',
      },
    })
    const prohibitedOrganization = approved({
      approver: {
        name: 'Dana Counsel',
        role: 'external_counsel',
        organization: 'Kodes Agency',
      },
    })

    for (const document of [wrongRole, prohibitedName, prohibitedOrganization]) {
      expect(validate([document], { [PRIVACY]: APPROVED_BODY })).toContain(
        'engineering cannot self-approve privacy-notice',
      )
    }
  })

  it('allows a non-counsel role to own a document that is not counsel-owned', () => {
    const factMap = approved({
      kind: 'engineering_fact_map',
      approver: {
        name: 'Bozhidar Denev',
        role: 'engineering',
        organization: 'Kodes Agency',
      },
    })

    expect(validate([factMap], { [PRIVACY]: APPROVED_BODY })).toEqual([])
  })

  it('rejects an approval that has passed its expiry date', () => {
    const errors = validate(
      [approved()],
      { [PRIVACY]: APPROVED_BODY },
      new Date('2027-09-02T00:00:00.000Z'),
    )

    expect(errors).toContain(
      'privacy-notice: approval expired (expiresOn 2027-09-01, now 2027-09-02)',
    )
  })

  it('keeps the shipped registry internally consistent about who may approve', () => {
    expect(
      LEGAL_DOCUMENT_REGISTRY.documents.every((document) => document.approver === null),
    ).toBe(true)
  })
})
