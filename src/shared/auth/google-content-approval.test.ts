import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRoleDocument,
} from './google-content-contract'
import {
  canonicalGoogleContentSha256,
  createGoogleContentRoleSignatureVerifier,
  googleContentRoleSignaturePayload,
  parseGoogleContentApprovalBundle,
  validateGoogleContentApprovalBundle,
  validateGoogleContentApprovalCandidate,
  type GoogleContentApprovalCandidate,
} from './google-content-approval'

const approvedAt = '2026-08-10T10:00:00.000Z'
const expiresAt = '2026-08-12T10:00:00.000Z'

const bindingBase = (): Omit<GoogleContentApprovalBinding, 'evidenceIndexSha256'> => ({
  capability: 'property.read_gbp_performance',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  releaseSha: 'release-sha',
  evidenceManifestSha256: canonicalGoogleContentSha256('manifest'),
  deploymentAttestationSha256: canonicalGoogleContentSha256('deployment'),
  adr0050Sha256: canonicalGoogleContentSha256('adr-0050'),
  googleContentPolicyVersion: 'google-content-live-1',
  googleOAuthContractVersion: 'google-oauth-oidc-1',
  googleProjectAttestationSha256: canonicalGoogleContentSha256('project-attestation'),
  googleOAuthClientIdSha256: canonicalGoogleContentSha256('oauth-client-id'),
  googleRedirectUriSha256: canonicalGoogleContentSha256('redirect-uri'),
  providerOriginProfileSha256: canonicalGoogleContentSha256('provider-origin-profile'),
  runtimeIsolationProfileVersion: 'google-content-egress-1',
  runtimeIsolationProfileSha256: canonicalGoogleContentSha256(
    'runtime-isolation-profile',
  ),
  performanceCatalogVersion: '2026-08-05',
  capabilityPolicyVersion: 'beta-local-2',
  executionPolicyVersion: 'beta-local-2',
  migrationHead: '0029_google-content-control',
  imageDigests: {
    web: `sha256:${canonicalGoogleContentSha256('web-image')}`,
    worker: `sha256:${canonicalGoogleContentSha256('worker-image')}`,
    googleExecutionAdmission: `sha256:${canonicalGoogleContentSha256('admission-image')}`,
    googleEgressGateway: `sha256:${canonicalGoogleContentSha256('gateway-image')}`,
    providerEphemeralRedis: `sha256:${canonicalGoogleContentSha256('redis-image')}`,
  },
  approvedAt,
  expiresAt,
  status: 'approved',
})

const roleDocument = (
  role: (typeof GOOGLE_CONTENT_APPROVAL_ROLES)[number],
): GoogleContentApprovalRoleDocument => ({
  role,
  capability: 'property.read_gbp_performance',
  manifestSha256: bindingBase().evidenceManifestSha256,
  releaseSha: 'release-sha',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  transientPerformanceReportingDecision: 'approved',
  confirmedImportProfileTreatmentDecision: 'approved',
  unmanagedUserAgentMemoryResidualDecision: 'approved',
  approverIdentity: `${role}-approver`,
  approvedAt,
  expiresAt,
  signature: `${role}-signature`,
})

const candidateFromRoleDocuments = (
  documents: readonly GoogleContentApprovalRoleDocument[],
): GoogleContentApprovalCandidate => {
  const roleDocuments = documents.map((document) => ({
    sha256: canonicalGoogleContentSha256(document),
    document,
  }))
  const indexDocument = {
    manifestSha256: bindingBase().evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase().deploymentAttestationSha256 },
    roleDocumentSha256: {
      'engineering/runtime': roleDocuments[0]!.sha256,
      'product/property': roleDocuments[1]!.sha256,
      'security/privacy': roleDocuments[2]!.sha256,
      'google-project/integration': roleDocuments[3]!.sha256,
      'operations/on-call': roleDocuments[4]!.sha256,
    },
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: { ...bindingBase(), evidenceIndexSha256: index.sha256 },
    index,
    roleDocuments,
  }
}

const candidate = (): GoogleContentApprovalCandidate =>
  candidateFromRoleDocuments(GOOGLE_CONTENT_APPROVAL_ROLES.map(roleDocument))
const binding = (): GoogleContentApprovalBinding => candidate().binding
const verifyRoleApproval = (document: GoogleContentApprovalRoleDocument) =>
  document.signature === `${document.role}-signature`

describe('Google Content approval candidate', () => {
  it('accepts an acyclic exact five-role chain', () => {
    expect(
      validateGoogleContentApprovalCandidate(
        candidate(),
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: true, binding: binding() })
  })

  it('recomputes the canonical manifest before accepting a bundle', () => {
    const input = { manifest: 'manifest', candidate: candidate() }
    expect(
      validateGoogleContentApprovalBundle(
        input,
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: true, binding: input.candidate.binding })
    expect(
      validateGoogleContentApprovalBundle(
        { ...input, manifest: 'substituted-manifest' },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'manifest_digest_mismatch' })
  })

  it('strictly parses bounded canonical approval bundles', () => {
    const documents = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => ({
      ...roleDocument(role),
      signature: Buffer.from(`${role}-signature`, 'utf8').toString('base64'),
    }))
    const input = {
      manifest: 'manifest',
      candidate: candidateFromRoleDocuments(documents),
    }
    expect(parseGoogleContentApprovalBundle(input)).toEqual({ ok: true, bundle: input })
    expect(parseGoogleContentApprovalBundle({ ...input, unexpected: true })).toEqual({
      ok: false,
    })
  })

  it('verifies role signatures over the canonical unsigned document', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const unsigned = roleDocument('engineering/runtime')
    const document = {
      ...unsigned,
      signature: sign(
        null,
        googleContentRoleSignaturePayload(unsigned),
        privateKey,
      ).toString('base64'),
    }
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const verifier = createGoogleContentRoleSignatureVerifier({
      'engineering/runtime': pem,
      'product/property': pem,
      'security/privacy': pem,
      'google-project/integration': pem,
      'operations/on-call': pem,
    })

    expect(verifier(document)).toBe(true)
    expect(verifier({ ...document, releaseSha: 'substituted-release' })).toBe(false)
  })
  it('rejects a role document whose signature does not verify', () => {
    const input = candidate()
    expect(
      validateGoogleContentApprovalCandidate(
        input,
        new Date('2026-08-11T10:00:00.000Z'),
        () => false,
      ),
    ).toEqual({ ok: false, code: 'invalid_role_signature' })
  })

  it('rejects a missing role before a binding can be persisted', () => {
    const input = candidate()
    expect(
      validateGoogleContentApprovalCandidate(
        { ...input, roleDocuments: input.roleDocuments.slice(0, 4) },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'missing_role_approval' })
  })

  it('rejects substituted index and manifest links', () => {
    const input = candidate()
    expect(
      validateGoogleContentApprovalCandidate(
        { ...input, index: { ...input.index, sha256: 'substituted-index' } },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'index_digest_mismatch' })

    const roleDocuments = input.roleDocuments.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            document: { ...entry.document, manifestSha256: 'substituted-manifest' },
          }
        : entry,
    )
    expect(
      validateGoogleContentApprovalCandidate(
        { ...input, roleDocuments },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'role_manifest_mismatch' })
  })

  it('rejects a role document with a stale digest', () => {
    const input = candidate()
    const roleDocuments = input.roleDocuments.map((entry, index) =>
      index === 2
        ? {
            ...entry,
            document: {
              ...entry.document,
              unmanagedUserAgentMemoryResidualDecision: 'denied' as const,
            },
          }
        : entry,
    )

    expect(
      validateGoogleContentApprovalCandidate(
        { ...input, roleDocuments },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'role_digest_mismatch' })
  })

  it('rejects a coherently hashed denied content-treatment decision', () => {
    const input = candidate()
    const documents = input.roleDocuments.map(
      ({ document }, index): GoogleContentApprovalRoleDocument =>
        index === 2
          ? {
              ...document,
              unmanagedUserAgentMemoryResidualDecision: 'denied',
            }
          : document,
    )

    expect(
      validateGoogleContentApprovalCandidate(
        candidateFromRoleDocuments(documents),
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'content_treatment_denied' })
  })

  it('rejects expired or non-approved bindings', () => {
    expect(
      validateGoogleContentApprovalCandidate(
        candidate(),
        new Date('2026-08-12T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'binding_expired' })

    const input = candidate()
    expect(
      validateGoogleContentApprovalCandidate(
        { ...input, binding: { ...input.binding, status: 'suspended' } },
        new Date('2026-08-11T10:00:00.000Z'),
        verifyRoleApproval,
      ),
    ).toEqual({ ok: false, code: 'binding_not_approved' })
  })
})
