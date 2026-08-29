import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalLegalDocumentRegistry,
  LEGAL_DOCUMENT_REGISTRY,
  LEGAL_DOCUMENT_REGISTRY_PATH,
  parseLegalDocumentRegistry,
} from './legal-document-registry'

const ROOT = resolve(import.meta.dirname, '../../..')

const shippedBytes = (): string =>
  readFileSync(resolve(ROOT, LEGAL_DOCUMENT_REGISTRY_PATH), 'utf8')

const approvedFields = {
  effectiveFrom: '2026-09-01',
  reviewDueOn: '2027-03-01',
  expiresOn: '2027-09-01',
  approvedAt: '2026-08-31T10:00:00.000Z',
  approver: { name: 'Dana Counsel', role: 'external_counsel', organization: 'Firm LLP' },
  approvalEvidenceRef: 'docs/release-evidence/legal/privacy-notice-approval.json',
} as const

const draftFields = {
  effectiveFrom: null,
  reviewDueOn: null,
  expiresOn: null,
  approvedAt: null,
  approver: null,
  approvalEvidenceRef: null,
} as const

/** Canonical bytes for an arbitrary candidate registry: keys sorted, indent 2. */
function registryWith(...documents: readonly unknown[]): string {
  const sortKeys = (_key: string, value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]]),
        )
      : value
  const registry = {
    version: 'repkey-legal-document-registry-1',
    updatedAt: '2026-08-28',
    documents,
  }
  return `${JSON.stringify(registry, sortKeys, 2)}\n`
}

const draftDocument = {
  id: 'privacy-notice',
  kind: 'counsel_approved',
  title: 'Privacy Notice',
  path: 'docs/legal/privacy-notice.md',
  version: '2.0-draft',
  status: 'draft',
  sha256: 'a'.repeat(64),
  ...draftFields,
}

const errorsOf = (content: string): readonly string[] => {
  const result = parseLegalDocumentRegistry(content)
  if (result.ok) throw new Error('expected the registry to be rejected')
  return result.errors
}

describe('legal document registry artifact', () => {
  it('ships bytes that are exactly the canonical encoding of what it parses to', () => {
    const bytes = shippedBytes()
    const parsed = parseLegalDocumentRegistry(bytes)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(canonicalLegalDocumentRegistry(parsed.registry)).toBe(bytes)
  })

  it('keeps the shipped artifact and the runtime constant byte-identical', () => {
    expect(canonicalLegalDocumentRegistry(LEGAL_DOCUMENT_REGISTRY)).toBe(shippedBytes())
  })

  it('rejects a non-canonical encoding of an otherwise valid registry', () => {
    const bytes = shippedBytes()

    expect(errorsOf(bytes.trimEnd())).toContain(
      'legal document registry must use canonical JSON encoding',
    )
  })

  it('rejects a duplicate document id', () => {
    expect(errorsOf(registryWith(draftDocument, draftDocument))).toContain(
      'registry: duplicate legal document id: privacy-notice',
    )
  })

  it('requires document ids to be sorted', () => {
    const later = { ...draftDocument, id: 'internal-beta-agreement' }

    expect(errorsOf(registryWith(draftDocument, later))).toContain(
      'registry: legal document ids must be sorted',
    )
  })

  it('rejects a draft that carries any approval field', () => {
    for (const field of [
      'effectiveFrom',
      'approver',
      'approvedAt',
      'approvalEvidenceRef',
    ] as const) {
      const document = { ...draftDocument, [field]: approvedFields[field] }

      expect(errorsOf(registryWith(document))).toContain(
        'documents.0: draft document must not carry approval fields',
      )
    }
  })

  it('rejects an approved document that is missing any approval field', () => {
    for (const field of [
      'effectiveFrom',
      'approvedAt',
      'approver',
      'approvalEvidenceRef',
      'reviewDueOn',
      'expiresOn',
    ] as const) {
      const document = {
        ...draftDocument,
        status: 'approved',
        ...approvedFields,
        [field]: null,
      }

      expect(errorsOf(registryWith(document))).toContain(
        `documents.0: approved document must carry ${field}`,
      )
    }
  })

  it('enforces effectiveFrom <= reviewDueOn <= expiresOn', () => {
    const reversed = {
      ...draftDocument,
      status: 'approved',
      ...approvedFields,
      effectiveFrom: '2027-04-01',
      reviewDueOn: '2027-03-01',
      expiresOn: '2027-02-01',
    }

    expect(errorsOf(registryWith(reversed))).toEqual(
      expect.arrayContaining([
        'documents.0: effectiveFrom must be on or before reviewDueOn',
        'documents.0: reviewDueOn must be on or before expiresOn',
      ]),
    )
  })

  it('accepts the same document once the approval dates are ordered', () => {
    const ordered = { ...draftDocument, status: 'approved', ...approvedFields }

    expect(parseLegalDocumentRegistry(registryWith(ordered)).ok).toBe(true)
  })

  it('rejects a sha256 that is not 64 lowercase hex characters', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}g`]) {
      expect(errorsOf(registryWith({ ...draftDocument, sha256 }))).not.toEqual([])
    }
  })

  it('rejects an escaping document path the way release evidence paths are bounded', () => {
    for (const path of [
      '/docs/legal/privacy-notice.md',
      'docs/../../etc/passwd',
      'docs\\legal\\privacy-notice.md',
      'docs/./legal/privacy-notice.md',
      'docs//legal/privacy-notice.md',
    ]) {
      expect(errorsOf(registryWith({ ...draftDocument, path }))).not.toEqual([])
    }
  })

  it('registers every customer-facing document as an unapproved draft today', () => {
    // The three customer-facing documents are `operator_acknowledged` for the
    // closed beta. The assertion is about their STATE — unapproved, no
    // approver — which must hold whoever is entitled to approve them, so it
    // matches on both kinds rather than on the one that happens to be current.
    const customerFacing = (document: { kind: string }) =>
      document.kind === 'counsel_approved' || document.kind === 'operator_acknowledged'
    expect(
      LEGAL_DOCUMENT_REGISTRY.documents.filter(
        (document) => customerFacing(document) && document.status === 'approved',
      ),
    ).toEqual([])
    expect(
      LEGAL_DOCUMENT_REGISTRY.documents
        .filter(customerFacing)
        .map((document) => ({ id: document.id, approver: document.approver })),
    ).toEqual([
      { id: 'google-access-disclosure', approver: null },
      { id: 'internal-beta-agreement', approver: null },
      { id: 'privacy-notice', approver: null },
    ])
  })
})
