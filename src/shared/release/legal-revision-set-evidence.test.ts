import { describe, expect, it } from 'vitest'
import { IN_PRODUCT_NOTICE_IDS } from '../governance/legal-link-targets'
import type { LegalDocumentRegistry } from '../governance/legal-document-registry'
import { LEGAL_PUBLICATION_DOCUMENT_IDS } from '../governance/legal-approval-authority'
import {
  candidateBindingErrors,
  canonicalReleaseEvidence,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  approvedLegalDocumentRegistryFixture,
  legalRevisionSetContextFixture,
  legalRevisionSetFixture,
} from './legal-revision-set-evidence.test-fixtures'
import {
  canonicalLegalRevisionSetEvidence,
  parseLegalRevisionSetEvidence,
  requiredLegalRevisionSetDocumentIds,
  type LegalRevisionSetContext,
  type LegalRevisionSetEvidence,
} from './legal-revision-set-evidence'

const CANDIDATE: ReleaseCandidateBinding = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  cell: 'us',
  environment: 'cell-us',
  deploymentProfile: 'production',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  projectId: 'railway-project-us-production',
  environmentId: 'railway-environment-cell-us',
  appOrigin: 'https://us.reputationkey.app',
}

const approvedRegistry = approvedLegalDocumentRegistryFixture

function context(registry: LegalDocumentRegistry): LegalRevisionSetContext {
  return legalRevisionSetContextFixture(registry)
}

function revisionSet(
  registry: LegalDocumentRegistry,
  overrides: Partial<LegalRevisionSetEvidence> = {},
): LegalRevisionSetEvidence {
  return legalRevisionSetFixture(CANDIDATE, context(registry), overrides)
}

function parse(evidence: LegalRevisionSetEvidence, registry: LegalDocumentRegistry) {
  return parseLegalRevisionSetEvidence(
    canonicalLegalRevisionSetEvidence(evidence),
    context(registry),
  )
}

function errorText(result: ReturnType<typeof parseLegalRevisionSetEvidence>): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.errors.join('\n')
}

describe('legal revision-set evidence', () => {
  it('accepts a canonical, candidate-bound, fully approved revision set', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const content = canonicalLegalRevisionSetEvidence(evidence)

    const result = parseLegalRevisionSetEvidence(content, context(registry))
    expect(result).toMatchObject({ ok: true })
    expect(content).toBe(canonicalReleaseEvidence(evidence))
    expect(evidence.version).toBe('repkey-legal-revision-set-1')
    expect(evidence.evidenceKind).toBe('legal-revision-set')
  })

  it('rejects a revision set produced for another release candidate', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry, {
      candidate: { ...CANDIDATE, releaseSha: 'c'.repeat(40) },
    })
    const parsed = parse(evidence, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Candidate binding is checked against the Gate F target, exactly as
    // recovery-rehearsal evidence is, so a proof from another SHA cannot be
    // relabelled.
    expect(candidateBindingErrors(parsed.evidence.candidate, CANDIDATE)).toEqual([
      'candidate.releaseSha: does not match the Gate F release target',
    ])
  })

  it('refuses any cell other than the single beta US Data Cell', () => {
    const registry = approvedRegistry()
    expect(
      errorText(parse(revisionSet(registry, { cell: 'europe' }), registry)),
    ).toContain('beta legal revision set must bind cell-us only')
    expect(
      errorText(parse(revisionSet(registry, { environment: 'cell-global' }), registry)),
    ).toContain('beta legal revision set must bind cell-us only')
  })

  it('refuses a draft entry outright', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const documents = evidence.documents.map((document) =>
      document.id === 'privacy-notice'
        ? { ...document, status: 'draft' as const }
        : document,
    )
    expect(errorText(parse({ ...evidence, documents }, registry))).toContain(
      'document privacy-notice is a draft and cannot appear in a release legal revision set',
    )
  })

  it('refuses a digest that disagrees with the legal document registry', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const documents = evidence.documents.map((document) =>
      document.id === 'privacy-notice'
        ? { ...document, sha256: 'd'.repeat(64) }
        : document,
    )
    expect(errorText(parse({ ...evidence, documents }, registry))).toContain(
      'document privacy-notice: digest does not match the legal document registry',
    )
  })

  it('refuses a registry reference that is not self-consistent', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    expect(
      errorText(
        parse(
          {
            ...evidence,
            registry: { ...evidence.registry, sha256: 'e'.repeat(64) },
          },
          registry,
        ),
      ),
    ).toContain('registry: digest does not match the legal document registry bytes')
  })

  it('refuses a revision set that omits any required document', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const documents = evidence.documents.filter(
      (document) => document.id !== 'merchant-ai-notice',
    )
    expect(errorText(parse({ ...evidence, documents }, registry))).toContain(
      'missing required legal document merchant-ai-notice',
    )
    expect(requiredLegalRevisionSetDocumentIds(context(registry))).toEqual(
      [...LEGAL_PUBLICATION_DOCUMENT_IDS, ...IN_PRODUCT_NOTICE_IDS].sort(),
    )
  })

  it('refuses a capture outside the approval window', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const expired = evidence.documents.map((document) =>
      document.id === 'internal-beta-agreement'
        ? { ...document, expiresOn: '2026-08-20' }
        : document,
    )
    expect(errorText(parse({ ...evidence, documents: expired }, registry))).toContain(
      'document internal-beta-agreement: approval expired before release capture',
    )

    const early = evidence.documents.map((document) =>
      document.id === 'internal-beta-agreement'
        ? { ...document, effectiveFrom: '2026-09-01' }
        : document,
    )
    expect(errorText(parse({ ...evidence, documents: early }, registry))).toContain(
      'document internal-beta-agreement: capture predates the approval effective date',
    )
  })

  it('refuses engineering self-approval of a counsel-owned document', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry)
    const engineering = evidence.documents.map((document) =>
      document.id === 'google-access-disclosure'
        ? {
            ...document,
            approver: {
              name: 'Bozhidar Denev',
              role: 'engineering' as const,
              organization: 'Kodes Agency',
            },
          }
        : document,
    )
    const text = errorText(parse({ ...evidence, documents: engineering }, registry))
    expect(text).toContain(
      'document google-access-disclosure must be approved by external counsel',
    )
    expect(text).toContain(
      'document google-access-disclosure: approver Bozhidar Denev cannot self-approve',
    )
  })

  it('cannot represent a passed outcome alongside recorded failures', () => {
    const registry = approvedRegistry()
    const evidence = revisionSet(registry, { failures: ['counsel review incomplete'] })
    expect(errorText(parse(evidence, registry))).toContain(
      'passed outcome requires an empty failure list',
    )
    expect(
      errorText(parse(revisionSet(registry, { outcome: 'failed' }), registry)),
    ).toContain('failed outcome requires at least one failure')
  })

  it('rejects non-canonical bytes', () => {
    const registry = approvedRegistry()
    const content = canonicalLegalRevisionSetEvidence(revisionSet(registry))
    const reindented = `${JSON.stringify(JSON.parse(content), null, 2)}\n`
    expect(
      errorText(parseLegalRevisionSetEvidence(reindented, context(registry))),
    ).toContain('must use canonical JSON encoding')
  })

  it('rejects the current repository state, where every counsel document is a draft', () => {
    // The default context is the shipped registry. This is the executable
    // statement that no legal revision set can be produced today.
    const registry = approvedRegistry()
    const content = canonicalLegalRevisionSetEvidence(revisionSet(registry))
    const text = errorText(parseLegalRevisionSetEvidence(content))
    expect(text).toContain('registry: digest does not match the legal document registry')
    // The shipped registry does not yet carry the in-product notice rows, and
    // its counsel rows are drafts: both are launch blockers, not warnings.
    expect(text).toContain(
      'document merchant-ai-notice is not registered in the legal document registry',
    )
    expect(text).toContain(
      'document privacy-notice: status does not match the legal document registry',
    )
  })
})
