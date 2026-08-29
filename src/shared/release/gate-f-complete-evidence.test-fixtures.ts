/**
 * A COMPLETE Gate F bundle, assembled from the real producer functions.
 *
 * The previous fixture covered three of eighteen gates with typed artifacts
 * and filled the other fifteen with `"<gate id> passed\n"`. That is the shape
 * of the fail-open this wave closes, so the negative controls have to run
 * against a bundle that is genuinely complete — otherwise "replacing a gate's
 * artifact with a placeholder makes it fail" is only provable for the three
 * gates that already had a producer.
 *
 * Nothing here is a hand-written literal of a producer's output: every typed
 * artifact comes from `gateFLiveEvidenceFixtures`, which builds real evidence
 * objects against the real schemas. A producer whose rules tighten breaks this
 * file rather than silently accepting weaker evidence.
 *
 * The approval envelopes are signed with keys generated IN THIS PROCESS and
 * discarded when it exits. No private key is read from or written to the
 * repository, here or anywhere else.
 */

import { generateKeyPairSync, sign as signPayload } from 'node:crypto'
import {
  canonicalPromotionManifest,
  promotionManifestSha256,
  PROMOTED_IMAGE_REPOSITORIES,
  PROMOTED_IMAGE_ROLES,
  PROMOTION_MANIFEST_VERSION,
  TRUSTED_RELEASE_REPOSITORY,
  TRUSTED_RELEASE_WORKFLOW_IDENTITY,
  type PromotionManifest,
} from './promotion-manifest'
import {
  RELEASE_BUILDKIT_IMAGE,
  RELEASE_BUILDKIT_VERSION,
  RELEASE_BUILDX_VERSION,
  RELEASE_DOCKER_VERSION,
  RELEASE_RUNNER_ARCHITECTURE,
  RELEASE_RUNNER_IMAGE_OS,
  RELEASE_RUNNER_LABEL,
} from './release-build-toolchain'
import {
  canonicalReleaseEvidence,
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
import {
  GATE_F_EVIDENCE_VERSION,
  GATE_F_REQUIRED_APPROVAL_ROLES,
  gateFApprovalRolesFor,
  type ReleasePosture,
  GATE_F_REQUIRED_GATE_IDS,
  canonicalGateFEvidence,
  gateFDecisionSha256,
  gateFEvidenceSha256,
  type GateFEvidence,
  type GateFEvidenceReference,
  type GateFValidationOptions,
} from './gate-f-evidence'
import {
  GATE_F_APPROVAL_ENVELOPE_VERSION,
  GATE_F_APPROVAL_ROLE_KEYS_VERSION,
  createGateFApprovalVerifier,
  gateFApprovalPublicKeySha256,
  gateFApprovalSignaturePayload,
  type GateFApprovalEnvelope,
  type GateFApprovalRole,
  type GateFApprovalRoleKeys,
} from './gate-f-approval-envelope'
import { gateFLiveEvidenceFixtures } from './gate-f-live-evidence.test-fixtures'
import {
  LEGAL_APPROVAL_CHECKLIST_VERSION,
  LEGAL_CHECKLIST_DOCUMENTS,
  LEG_01_REQUIRED_FACT_KEYS,
  canonicalLegalApprovalChecklist,
  type LegalApprovalChecklist,
} from './legal-approval-checklist'
import {
  approvedLegalDocumentsFixture,
  legalDocumentReaderFixture,
  legalRevisionSetContextFixture,
  legalRevisionSetFixtureContent,
} from './legal-revision-set-evidence.test-fixtures'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

const COMPLETE_BUNDLE_CAPTURED_AT = '2026-08-28T10:00:00.000Z'
const COMPLETE_BUNDLE_APPROVED_AT = '2026-08-28T11:00:00.000Z'
const COMPLETE_BUNDLE_APPROVAL_ARTIFACT_AT = '2026-08-28T11:01:00.000Z'
const COMPLETE_BUNDLE_COMPLETED_AT = '2026-08-28T12:00:00.000Z'

function completeBundlePromotionManifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-28T08:00:00.000Z',
    source: { repository: TRUSTED_RELEASE_REPOSITORY, ref: 'refs/heads/main' },
    ci: {
      workflowIdentity: TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      runId: '1234',
      runAttempt: 1,
    },
    build: {
      runnerLabel: RELEASE_RUNNER_LABEL,
      runnerImageOS: RELEASE_RUNNER_IMAGE_OS,
      runnerImageVersion: '20260824.1.0',
      runnerArchitecture: RELEASE_RUNNER_ARCHITECTURE,
      dockerVersion: RELEASE_DOCKER_VERSION,
      buildxVersion: RELEASE_BUILDX_VERSION,
      buildkitVersion: RELEASE_BUILDKIT_VERSION,
      buildkitImage: RELEASE_BUILDKIT_IMAGE,
      imageMetadataIndexSha256: digest('e'),
    },
    contract: {
      lockfileSha256: digest('1'),
      iacSha256: digest('2'),
      releaseControllerSha256: digest('3'),
      migrationHead: '0140_single_us_data_cell_cutover',
      capabilityPolicyVersion: 'beta-us-1',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: digest('4'),
      testEvidenceSha256: digest('5'),
      providerApprovalEvidenceSha256: digest('6'),
      sbomIndexSha256: digest('7'),
      vulnerabilityIndexSha256: digest('8'),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
          digest: `sha256:${digest(String((index % 8) + 1))}`,
          sourceRevision: releaseSha,
          sbomSha256: digest('9'),
          provenanceSha256: digest('a'),
          signatureBundleSha256: digest('b'),
          vulnerabilityReportSha256: digest('c'),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

export function completeBundleCandidate(
  overrides: Partial<ReleaseCandidateBinding> = {},
): ReleaseCandidateBinding {
  const manifest = completeBundlePromotionManifest()
  return {
    releaseSha: manifest.releaseSha,
    releaseManifestSha256: promotionManifestSha256(canonicalPromotionManifest(manifest)),
    cell: 'us',
    environment: 'cell-us',
    deploymentProfile: 'production',
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    projectId: 'railway-project-us-production',
    environmentId: 'railway-environment-cell-us',
    appOrigin: 'https://us.reputationkey.app',
    ...overrides,
  }
}

/** Ephemeral Ed25519 role keys. The private halves never leave this process. */
export type GateFApprovalKeyRing = Readonly<{
  roleKeys: GateFApprovalRoleKeys
  sign: (role: GateFApprovalRole, payload: Buffer) => string
  /** A key that is valid but enrolled for nobody, for the unknown-key control. */
  strangerPublicKeySha256: string
  signWithStranger: (payload: Buffer) => string
}>

export function gateFApprovalKeyRing(): GateFApprovalKeyRing {
  const pairs = new Map(
    GATE_F_REQUIRED_APPROVAL_ROLES.map((role) => [role, generateKeyPairSync('ed25519')]),
  )
  const stranger = generateKeyPairSync('ed25519')
  const roleEntry = (role: GateFApprovalRole) => {
    const pair = pairs.get(role)
    if (!pair) throw new Error(`no key pair for ${role}`)
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    return {
      status: 'enrolled' as const,
      custodian: `${role}-custodian`,
      enrolledAt: '2026-08-01T00:00:00.000Z',
      publicKeyPem,
      publicKeySha256: gateFApprovalPublicKeySha256(publicKeyPem),
    }
  }
  return {
    roleKeys: {
      version: GATE_F_APPROVAL_ROLE_KEYS_VERSION,
      roles: {
        counsel: roleEntry('counsel'),
        founder: roleEntry('founder'),
        operations: roleEntry('operations'),
        product: roleEntry('product'),
        security: roleEntry('security'),
        support_incident: roleEntry('support_incident'),
      },
    },
    sign: (role, payload) => {
      const pair = pairs.get(role)
      if (!pair) throw new Error(`no key pair for ${role}`)
      return signPayload(null, payload, pair.privateKey).toString('base64')
    },
    strangerPublicKeySha256: gateFApprovalPublicKeySha256(
      stranger.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ),
    signWithStranger: (payload) =>
      signPayload(null, payload, stranger.privateKey).toString('base64'),
  }
}

export type CompleteGateFBundle = Readonly<{
  candidate: ReleaseCandidateBinding
  evidence: GateFEvidence
  content: string
  files: ReadonlyMap<string, Uint8Array>
  options: GateFValidationOptions
  keyRing: GateFApprovalKeyRing
  decisionSha256: string
}>

export type CompleteGateFBundleOverrides = Readonly<{
  /**
   * Declare the release posture, which decides the required approval set.
   * Defaults to 'ga' so every existing control keeps measuring the full
   * six-role requirement.
   */
  posture?: ReleasePosture
  /**
   * Sign these roles instead of the posture's required set. Used to prove the
   * posture is load-bearing — e.g. a founder-only bundle that declares 'ga'.
   */
  approvalRoles?: readonly GateFApprovalRole[]
  /** Replace one gate's PRIMARY artifact bytes (the negative control). */
  gateArtifacts?: Readonly<Record<string, string>>
  /** Drop these approval roles' signatures (empty string signature). */
  unsignedRoles?: readonly GateFApprovalRole[]
  /** Sign these roles with a key nobody enrolled. */
  strangerSignedRoles?: readonly GateFApprovalRole[]
  /** Replace the legal revision-set bytes (LEG-01 negative controls). */
  legalRevisionSetContent?: string
  /** Replace the legal approval checklist bytes. */
  legalChecklistContent?: string
  /** Expire the legal approval before Gate F completes. */
  legalChecklistExpiresAt?: string
  /** Rename an approver identity, e.g. to give counsel an engineering handle. */
  approverIdentities?: Readonly<Record<string, string>>
  /** Sign counsel over a different decision digest. */
  counselDecisionSha256?: string
  completedAt?: string
}>

function legalChecklistArtifact(
  candidate: ReleaseCandidateBinding,
  legalRevisionSetSha256: string,
  documents: ReadonlyMap<string, Uint8Array>,
  expiresAt: string,
): LegalApprovalChecklist {
  return {
    version: LEGAL_APPROVAL_CHECKLIST_VERSION,
    evidenceKind: 'legal-approval-checklist',
    candidate,
    capturedAt: COMPLETE_BUNDLE_CAPTURED_AT,
    legalRevisionSetSha256,
    counselIdentity: 'A. Counsel',
    counselOrganization: 'External Counsel LLP',
    approvedAt: '2026-08-27T12:00:00.000Z',
    effectiveAt: '2026-08-27T00:00:00.000Z',
    expiresAt,
    documents: LEGAL_CHECKLIST_DOCUMENTS.map(({ documentId, path }) => {
      const bytes = documents.get(path)
      if (bytes === undefined) throw new Error(`no fixture document at ${path}`)
      return {
        documentId,
        path,
        versionId: '2.0',
        sha256: releaseEvidenceSha256(bytes),
        effectiveAt: '2026-08-27T00:00:00.000Z',
        reviewAt: '2026-11-27T00:00:00.000Z',
        expiresAt,
      }
    }),
    facts: LEG_01_REQUIRED_FACT_KEYS.map((key) => ({
      key,
      decided: true,
      decision: `counsel decided ${key} for the closed US beta`,
      decidedBy: 'A. Counsel',
      decidedAt: '2026-08-27T11:00:00.000Z',
      sourceDocumentId: 'privacy-notice',
      checklistItemIds: [`${key}.decision`],
    })),
    outcome: 'passed',
    failures: [],
  }
}

export function completeGateFBundle(
  overrides: CompleteGateFBundleOverrides = {},
): CompleteGateFBundle {
  const files = new Map<string, Uint8Array>()
  const addPayload = (
    path: string,
    payload: string,
    capturedAt = COMPLETE_BUNDLE_CAPTURED_AT,
  ): GateFEvidenceReference => {
    const bytes = Buffer.from(payload)
    files.set(path, bytes)
    return { path, sha256: gateFEvidenceSha256(bytes), capturedAt }
  }

  const manifest = completeBundlePromotionManifest()
  const manifestReference = addPayload(
    'release/promotion-manifest.json',
    canonicalPromotionManifest(manifest),
  )
  const candidate = completeBundleCandidate()

  const legalDocuments = approvedLegalDocumentsFixture()
  const legalContext = legalRevisionSetContextFixture(legalDocuments.registry)
  const legalRevisionSet = addPayload(
    'legal/revision-set.json',
    overrides.legalRevisionSetContent ??
      legalRevisionSetFixtureContent(candidate, legalContext),
  )
  const legalChecklist = addPayload(
    'legal/approval-checklist.json',
    overrides.legalChecklistContent ??
      canonicalLegalApprovalChecklist(
        legalChecklistArtifact(
          candidate,
          legalRevisionSet.sha256,
          legalDocuments.files,
          overrides.legalChecklistExpiresAt ?? '2027-02-27T00:00:00.000Z',
        ),
      ),
  )

  const typed = gateFLiveEvidenceFixtures(candidate)
  const gates = GATE_F_REQUIRED_GATE_IDS.map((id) => {
    const fixture = typed[id]
    if (!fixture) throw new Error(`no typed producer fixture for gate ${id}`)
    const primary = overrides.gateArtifacts?.[id] ?? fixture.content
    return {
      id,
      status: 'passed' as const,
      evidence: [
        addPayload(`gates/${id}.json`, primary),
        ...fixture.dependencies.map((dependency) =>
          addPayload(dependency.path, dependency.payload, dependency.capturedAt),
        ),
      ],
    }
  })

  const decisionSource = {
    version: GATE_F_EVIDENCE_VERSION,
    release: {
      manifest: manifestReference,
      signatureBundle: addPayload(
        'release/promotion-manifest.sigstore.json',
        '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}\n',
      ),
      legalRevisionSet,
      legalApprovalChecklist: legalChecklist,
      releaseSha: manifest.releaseSha,
      // Full six-role posture: these fixtures exist to prove the complete
      // approval set, so they must not sit in the narrowed closed-beta case.
      posture: overrides.posture ?? ('ga' as const),
      cell: 'us' as const,
      environment: 'cell-us' as const,
      deploymentProfile: 'production' as const,
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: candidate.projectId,
      environmentId: candidate.environmentId,
      appOrigin: 'https://us.reputationkey.app' as const,
    },
    gates,
    findings: {
      protectedReachableHighCount: 0 as const,
      register: addPayload('findings/register.json', 'no protected reachable High\n'),
    },
    firstCohort: {
      kind: 'design_partner' as const,
      cohortReferenceSha256: digest('d'),
      supportOwner: 'support-owner',
      incidentOwner: 'incident-owner',
      changeRecord: 'CHG-REL-01-001',
      evidence: addPayload('cohort/readiness.json', 'bounded cohort ready\n'),
    },
    completedAt: overrides.completedAt ?? COMPLETE_BUNDLE_COMPLETED_AT,
  }

  // The decision digest deliberately ignores `approvals`, so it can be computed
  // before a single approver has signed.
  const decisionSha256 = gateFDecisionSha256({
    ...decisionSource,
    approvals: [],
  } as unknown as GateFEvidence)

  const keyRing = gateFApprovalKeyRing()
  const signingRoles =
    overrides.approvalRoles ?? gateFApprovalRolesFor(overrides.posture ?? 'ga')
  const approvals = signingRoles.map((role) => {
    const approverIdentity = overrides.approverIdentities?.[role] ?? `${role}-approver`
    const signedDecision =
      role === 'counsel' && overrides.counselDecisionSha256 !== undefined
        ? overrides.counselDecisionSha256
        : decisionSha256
    const payload = gateFApprovalSignaturePayload({
      role,
      approverIdentity,
      approvedAt: COMPLETE_BUNDLE_APPROVED_AT,
      releaseManifestSha256: manifestReference.sha256,
      legalRevisionSetSha256: legalRevisionSet.sha256,
      gateFDecisionSha256: signedDecision,
    })
    const stranger = overrides.strangerSignedRoles?.includes(role) ?? false
    const unsigned = overrides.unsignedRoles?.includes(role) ?? false
    const envelope: GateFApprovalEnvelope = {
      version: GATE_F_APPROVAL_ENVELOPE_VERSION,
      evidenceKind: 'gate-f-approval',
      role,
      approverIdentity,
      approvedAt: COMPLETE_BUNDLE_APPROVED_AT,
      releaseManifestSha256: manifestReference.sha256,
      legalRevisionSetSha256: legalRevisionSet.sha256,
      // The ENVELOPE always names this bundle's decision. When
      // `counselDecisionSha256` is set the SIGNATURE covers a different one,
      // which is exactly the substitution the verifier must catch.
      gateFDecisionSha256: decisionSha256,
      publicKeySha256: stranger
        ? keyRing.strangerPublicKeySha256
        : (() => {
            const entry = keyRing.roleKeys.roles[role]
            if (entry.status !== 'enrolled') throw new Error('fixture key not enrolled')
            return entry.publicKeySha256
          })(),
      signatureAlgorithm: 'ed25519',
      signature: unsigned
        ? 'A'.repeat(88)
        : stranger
          ? keyRing.signWithStranger(payload)
          : keyRing.sign(role, payload),
    }
    const evidence = addPayload(
      `approvals/${role}.json`,
      `${JSON.stringify(envelope, null, 2)}\n`,
      COMPLETE_BUNDLE_APPROVAL_ARTIFACT_AT,
    )
    const base = {
      approverIdentity: envelope.approverIdentity,
      approvedAt: envelope.approvedAt,
      releaseManifestSha256: envelope.releaseManifestSha256,
      evidence,
    }
    return role === 'counsel' || role === 'founder'
      ? { role, ...base, legalRevisionSetSha256: legalRevisionSet.sha256 }
      : { role, ...base }
  })

  const evidence = {
    ...decisionSource,
    approvals,
  } as GateFEvidence

  return {
    candidate,
    evidence,
    content: canonicalGateFEvidence(evidence),
    files,
    options: {
      verifyApproval: createGateFApprovalVerifier(keyRing.roleKeys),
      legalRevisionSet: legalContext,
      legalDocuments: { readDocument: legalDocumentReaderFixture(legalDocuments.files) },
    },
    keyRing,
    decisionSha256,
  }
}

export function completeGateFBundleReader(
  files: ReadonlyMap<string, Uint8Array>,
): (path: string) => Uint8Array {
  return (path) => {
    const payload = files.get(path)
    if (!payload) throw new Error(`missing fixture ${path}`)
    return payload
  }
}

/**
 * A canary artifact captured against the REHEARSAL Railway project. Beta
 * rehearsal evidence can never be relabelled as production evidence, so this
 * must be refused rather than merely discouraged.
 */
export function rehearsalCanaryArtifact(files: ReadonlyMap<string, Uint8Array>): string {
  const path = 'gates/promotion.canary_window.json'
  const bytes = files.get(path)
  if (!bytes) throw new Error('bundle has no canary artifact')
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<
    string,
    unknown
  >
  const candidate = parsed.candidate as Record<string, unknown>
  return canonicalReleaseEvidence({
    ...parsed,
    candidate: {
      ...candidate,
      projectName: 'reputation-key-us-beta-rehearsal',
      deploymentProfile: 'rehearsal',
    },
  })
}
