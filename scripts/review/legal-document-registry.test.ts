import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalLegalDocumentRegistry,
  LEGAL_DOCUMENT_REGISTRY,
  type LegalDocument,
  type LegalDocumentRegistry,
} from '../../src/shared/governance/legal-document-registry'
import { runLegalDocumentRegistryCli } from './legal-document-registry'

const SHIPPED_PATHS = LEGAL_DOCUMENT_REGISTRY.documents.map((document) => document.path)

function fixtureRegistry(mutate: (registry: LegalDocumentRegistry) => LegalDocument[]) {
  const registry: LegalDocumentRegistry = {
    ...LEGAL_DOCUMENT_REGISTRY,
    documents: mutate(LEGAL_DOCUMENT_REGISTRY),
  }
  const directory = mkdtempSync(join(tmpdir(), 'repkey-legal-'))
  const path = join(directory, 'legal-document-registry.json')
  writeFileSync(path, canonicalLegalDocumentRegistry(registry))
  return path
}

function run(args: readonly string[], listed: readonly string[] = SHIPPED_PATHS) {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const code = runLegalDocumentRegistryCli(args, { listLegalDocuments: () => listed })
  const text = (spy: typeof stdout): string =>
    spy.mock.calls.map((call) => String(call[0])).join('')
  return { code, stdout: text(stdout), stderr: text(stderr) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('legal document registry CLI', () => {
  it('passes against the repository today and reports the open blockers', () => {
    const result = run([])

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      documents: 5,
      draft: 5,
      approved: 0,
      blockers: ['privacy-notice', 'internal-beta-agreement', 'google-access-disclosure'],
    })
  })

  it('fails when an approved document drifted from its recorded digest', () => {
    const path = fixtureRegistry((registry) =>
      registry.documents.map((document) =>
        document.id === 'privacy-notice'
          ? {
              ...document,
              status: 'approved' as const,
              version: '2.0',
              effectiveFrom: '2026-09-01',
              reviewDueOn: '2027-03-01',
              expiresOn: '2099-09-01',
              approvedAt: '2026-08-31T10:00:00.000Z',
              approver: {
                name: 'Dana Counsel',
                role: 'external_counsel' as const,
                organization: 'Firm LLP',
              },
              approvalEvidenceRef: 'docs/legal/implementation-facts-2026-08-26.md',
              sha256: 'b'.repeat(64),
            }
          : document,
      ),
    )

    const result = run(['--registry', path])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'privacy-notice: approved document changed after approval',
    )
  })

  it('fails when a document under docs/legal has no registry entry', () => {
    const result = run([], [...SHIPPED_PATHS, 'docs/legal/orphan-notice.md'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'unregistered legal document: docs/legal/orphan-notice.md',
    )
  })

  it('fails when a registry entry points at a file that does not exist', () => {
    const missing: LegalDocument = {
      ...LEGAL_DOCUMENT_REGISTRY.documents[0]!,
      id: 'zz-missing-document',
      path: 'docs/legal/zz-missing-document.md',
    }
    const path = fixtureRegistry((registry) => [...registry.documents, missing])

    const result = run(['--registry', path])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'zz-missing-document: legal document cannot be read at docs/legal/zz-missing-document.md',
    )
  })

  it('refuses an approval that outruns its open counsel decisions', () => {
    const path = fixtureRegistry((registry) =>
      registry.documents.map((document) =>
        document.id === 'google-access-disclosure'
          ? {
              ...document,
              status: 'approved' as const,
              effectiveFrom: '2026-09-01',
              reviewDueOn: '2027-03-01',
              expiresOn: '2099-09-01',
              approvedAt: '2026-08-31T10:00:00.000Z',
              approver: {
                name: 'Dana Counsel',
                role: 'external_counsel' as const,
                organization: 'Firm LLP',
              },
              approvalEvidenceRef: 'docs/legal/implementation-facts-2026-08-26.md',
            }
          : document,
      ),
    )

    const result = run(['--registry', path])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(
      /cannot approve google-access-disclosure: \d+ open counsel decisions \(/u,
    )
  })

  it('fails when the registry file itself is missing', () => {
    const result = run(['--registry', resolve(tmpdir(), 'no-such-registry.json')])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('legal document registry')
  })
})
