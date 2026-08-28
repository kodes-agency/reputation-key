import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRoleDocument,
} from './google-content-contract'
import {
  canonicalGoogleContentSha256,
  parseGoogleContentApprovalBundle,
  validateGoogleContentApprovalCandidate,
  type GoogleContentApprovalCandidate,
} from './google-content-approval'

const approvedAt = '2026-08-12T10:00:00.000Z'
const expiresAt = '2026-09-11T10:00:00.000Z'
const organizationId = 'org-closed-beta-1'
const cohortSha256 = canonicalGoogleContentSha256([organizationId])
const residualRiskSha256 = canonicalGoogleContentSha256('adr-0050-railway-residual')
const accountableOwnerIdentity = 'Bozhidar Denev <denev@kodes.agency>'

function bindingBase(): Omit<GoogleContentApprovalBinding, 'evidenceIndexSha256'> {
  return {
    capability: 'property.import_gbp_v2',
    targetPhase: 'railway_closed_beta',
    environmentProfile: 'railway-closed-beta-1',
    releaseSha: 'railway-release-sha',
    evidenceManifestSha256: canonicalGoogleContentSha256('manifest'),
    deploymentAttestationSha256: canonicalGoogleContentSha256('deployment'),
    adr0050Sha256: canonicalGoogleContentSha256('adr-0050'),
    googleContentPolicyVersion: 'google-content-live-1',
    googleOAuthContractVersion: 'google-oauth-oidc-1',
    googleProjectAttestationSha256: canonicalGoogleContentSha256('project-attestation'),
    googleOAuthClientIdSha256: canonicalGoogleContentSha256('oauth-client-id'),
    googleRedirectUriSha256: canonicalGoogleContentSha256('redirect-uri'),
    providerOriginProfileSha256: canonicalGoogleContentSha256('provider-origin-profile'),
    runtimeIsolationProfileVersion: null,
    runtimeIsolationProfileSha256: null,
    railwayClosedBetaCohort: [organizationId],
    railwayClosedBetaCohortSha256: cohortSha256,
    railwayClosedBetaResidualRiskSha256: residualRiskSha256,
    performanceCatalogVersion: '2026-08-05',
    routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    capabilityPolicyVersion: 'beta-local-2',
    executionPolicyVersion: 'beta-local-2',
    migrationHead: '0040_google-import-effect-lease-control-fk',
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
  }
}

function roleDocument(
  role: (typeof GOOGLE_CONTENT_APPROVAL_ROLES)[number],
): GoogleContentApprovalRoleDocument {
  return {
    role,
    capability: 'property.import_gbp_v2',
    manifestSha256: bindingBase().evidenceManifestSha256,
    releaseSha: 'railway-release-sha',
    targetPhase: 'railway_closed_beta',
    environmentProfile: 'railway-closed-beta-1',
    transientPerformanceReportingDecision: 'approved',
    confirmedImportProfileTreatmentDecision: 'approved',
    unmanagedUserAgentMemoryResidualDecision: 'approved',
    railwayClosedBetaResidualDecision: 'approved',
    railwayClosedBetaCohortSha256: cohortSha256,
    railwayClosedBetaResidualRiskSha256: residualRiskSha256,
    approverIdentity: accountableOwnerIdentity,
    approvedAt,
    expiresAt,
    signature: `${role}-signature`,
  }
}

function candidateFromDocuments(
  documents: readonly GoogleContentApprovalRoleDocument[],
  bindingOverride: Partial<GoogleContentApprovalBinding> = {},
): GoogleContentApprovalCandidate {
  const roleDocuments = documents.map((document) => ({
    sha256: canonicalGoogleContentSha256(document),
    document,
  }))
  const indexDocument = {
    manifestSha256: bindingBase().evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase().deploymentAttestationSha256 },
    roleDocumentSha256: Object.fromEntries(
      roleDocuments.map((entry) => [entry.document.role, entry.sha256]),
    ) as GoogleContentApprovalCandidate['index']['roleDocumentSha256'],
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: { ...bindingBase(), evidenceIndexSha256: index.sha256, ...bindingOverride },
    index,
    roleDocuments,
  }
}

const candidate = (
  bindingOverride: Partial<GoogleContentApprovalBinding> = {},
): GoogleContentApprovalCandidate =>
  candidateFromDocuments(GOOGLE_CONTENT_APPROVAL_ROLES.map(roleDocument), bindingOverride)

const verifyRoleApproval = (document: GoogleContentApprovalRoleDocument) =>
  document.signature === `${document.role}-signature`

function validate(input: GoogleContentApprovalCandidate) {
  return validateGoogleContentApprovalCandidate(
    input,
    new Date('2026-08-20T10:00:00.000Z'),
    verifyRoleApproval,
  )
}

describe('Railway closed-beta approval exception', () => {
  it('accepts only the exact Railway phase/profile with a null isolation pair', () => {
    expect(validate(candidate())).toEqual({ ok: true, binding: candidate().binding })
    expect(
      validate(
        candidate({
          runtimeIsolationProfileVersion: 'google-content-egress-1',
          runtimeIsolationProfileSha256: canonicalGoogleContentSha256('fake-isolation'),
        }),
      ),
    ).toEqual({ ok: false, code: 'invalid_phase_profile' })
  })

  it('requires one accountable owner across all five signed role attestations', () => {
    const mixedOwners = GOOGLE_CONTENT_APPROVAL_ROLES.map((role, index) => ({
      ...roleDocument(role),
      approverIdentity:
        index === 4
          ? 'Alternate Owner <alternate@example.test>'
          : accountableOwnerIdentity,
    }))

    expect(validate(candidateFromDocuments(mixedOwners))).toEqual({
      ok: false,
      code: 'railway_approval_owner_mismatch',
    })
  })

  it('rejects missing, denied, or mismatched residual-risk role decisions', () => {
    const validBundle = {
      manifest: 'manifest',
      candidate: candidateFromDocuments(GOOGLE_CONTENT_APPROVAL_ROLES.map(roleDocument)),
    }
    const firstDocument = validBundle.candidate.roleDocuments[0]!.document
    const { railwayClosedBetaResidualDecision: _decision, ...missingResidualDecision } =
      firstDocument
    expect(
      parseGoogleContentApprovalBundle({
        ...validBundle,
        candidate: {
          ...validBundle.candidate,
          roleDocuments: validBundle.candidate.roleDocuments.map((entry, index) =>
            index === 0 ? { ...entry, document: missingResidualDecision } : entry,
          ),
        },
      }),
    ).toEqual({ ok: false })

    const denied = GOOGLE_CONTENT_APPROVAL_ROLES.map((role, index) => ({
      ...roleDocument(role),
      railwayClosedBetaResidualDecision:
        index === 2 ? ('denied' as const) : ('approved' as const),
    }))
    expect(validate(candidateFromDocuments(denied))).toEqual({
      ok: false,
      code: 'railway_residual_risk_denied',
    })

    const mismatched = GOOGLE_CONTENT_APPROVAL_ROLES.map((role, index) => ({
      ...roleDocument(role),
      railwayClosedBetaCohortSha256:
        index === 0 ? canonicalGoogleContentSha256(['other-org']) : cohortSha256,
    }))
    expect(validate(candidateFromDocuments(mismatched))).toEqual({
      ok: false,
      code: 'railway_residual_binding_mismatch',
    })
  })

  it('rejects empty, duplicate, substituted, or wildcard cohorts', () => {
    expect(
      validate(
        candidate({
          railwayClosedBetaCohort: [],
          railwayClosedBetaCohortSha256: canonicalGoogleContentSha256([]),
        }),
      ),
    ).toEqual({ ok: false, code: 'invalid_railway_cohort' })
    expect(
      validate(
        candidate({
          railwayClosedBetaCohort: [organizationId, organizationId],
          railwayClosedBetaCohortSha256: canonicalGoogleContentSha256([
            organizationId,
            organizationId,
          ]),
        }),
      ),
    ).toEqual({ ok: false, code: 'invalid_railway_cohort' })
    expect(
      validate(
        candidate({
          railwayClosedBetaCohort: ['*'],
          railwayClosedBetaCohortSha256: canonicalGoogleContentSha256(['*']),
        }),
      ),
    ).toEqual({ ok: false, code: 'invalid_railway_cohort' })
    expect(
      validate(
        candidate({
          railwayClosedBetaCohort: [organizationId, 'org-closed-beta-2'],
        }),
      ),
    ).toEqual({ ok: false, code: 'railway_cohort_digest_mismatch' })
  })

  it('limits Railway approvals to thirty days and rejects Railway fields elsewhere', () => {
    expect(validate(candidate({ expiresAt: '2026-09-11T10:00:00.001Z' }))).toEqual({
      ok: false,
      code: 'invalid_approval_window',
    })

    expect(
      validate(
        candidate({
          targetPhase: 'production_expand_canary',
          environmentProfile: 'production',
          runtimeIsolationProfileVersion: 'google-content-egress-1',
          runtimeIsolationProfileSha256:
            canonicalGoogleContentSha256('runtime-isolation'),
        }),
      ),
    ).toEqual({ ok: false, code: 'invalid_phase_profile' })
  })
})
