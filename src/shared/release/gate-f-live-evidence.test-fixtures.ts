import {
  canonicalReleaseEvidence,
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
import {
  BACKUP_PITR_RECEIPT_EVIDENCE_VERSION,
  CLEAN_CI_RUN_EVIDENCE_VERSION,
  COHORT_READINESS_CHECKS,
  COHORT_READINESS_EVIDENCE_VERSION,
  DEFECT_DISPOSITION_EVIDENCE_VERSION,
  INDEPENDENT_REVIEW_EVIDENCE_VERSION,
  ISOLATED_RESTORE_MIGRATION_EVIDENCE_VERSION,
  LIVE_PROVIDER_MATRIX_EVIDENCE_VERSION,
  LIVE_PROVIDER_SURFACES,
  PREPRODUCTION_JOURNEY_EVIDENCE_VERSION,
  PREPRODUCTION_JOURNEY_GATE_CLASS,
  RELEASE_IMAGES_WORKFLOW_REF,
  TELEMETRY_CONTENT_INSPECTION_EVIDENCE_VERSION,
  TELEMETRY_INSPECTED_SINKS,
  TELEMETRY_PROHIBITED_FIELD_CLASSES,
  type BackupPitrReceiptEvidence,
  type CleanCiRunEvidence,
  type CohortReadinessEvidence,
  type DefectDispositionEvidence,
  type IndependentReviewEvidence,
  type IsolatedRestoreMigrationEvidence,
  type LiveProviderMatrixEvidence,
  type PreproductionJourneyEvidence,
  type TelemetryContentInspectionEvidence,
} from './live-evidence'
import {
  DORMANT_DATA_CELL_IDS,
  PROMOTION_READBACK_EVIDENCE_VERSION,
  PROMOTION_READBACK_SERVICES,
  type PromotionReadbackEvidence,
} from './promotion-readback-evidence'
import { RAILWAY_PLAN_EVIDENCE_VERSION } from './railway-plan-evidence'
import {
  canonicalDeployedCriticalJourneyEvidence,
  DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION,
  DEPLOYED_CRITICAL_JOURNEY_SPEC,
  type DeployedCriticalJourneyEvidence,
} from './deployed-critical-journey-evidence'
import {
  CANARY_THRESHOLD_PROFILE_VERSION,
  CANARY_WINDOW_EVIDENCE_VERSION,
  canonicalCanaryWindowEvidence,
  type CanaryWindowEvidence,
} from './canary-window-evidence'
import {
  canonicalRecoveryRehearsalEvidence,
  RECOVERY_REHEARSAL_EVIDENCE_VERSION,
  type RecoveryRehearsalEvidence,
} from './recovery-rehearsal-evidence'

export type GateFLiveEvidenceFixture = Readonly<{
  content: string
  dependencies: ReadonlyArray<
    Readonly<{ path: string; payload: string; capturedAt: string }>
  >
}>

function dependencyRecorder(gateId: string) {
  const dependencies: Array<{
    path: string
    payload: string
    capturedAt: string
  }> = []
  const sha256 = (name: string): string => {
    const path = `gates/${gateId}/dependencies/${name}.txt`
    const payload = `${gateId}:${name}\n`
    dependencies.push({
      path,
      payload,
      capturedAt: '2026-08-28T09:32:00.000Z',
    })
    return releaseEvidenceSha256(payload)
  }
  const reference = (name: string, capturedAt = '2026-08-28T08:00:00.000Z') => ({
    sha256: sha256(name),
    capturedAt,
  })
  return { dependencies, sha256, reference }
}

function deployed(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.deployed_critical_journeys')
  const evidence: DeployedCriticalJourneyEvidence = {
    version: DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION,
    evidenceKind: 'deployed-critical-journeys',
    candidate,
    runId: '40000000-0000-4000-8000-000000000001',
    startedAt: '2026-08-28T08:30:00.000Z',
    completedAt: '2026-08-28T08:40:00.000Z',
    capturedAt: '2026-08-28T08:41:00.000Z',
    authorization: {
      syntheticOrganizationId: '40000000-0000-4000-8000-000000000002',
      authorizationArtifactSha256: deps.sha256('authorization'),
      approvedBy: 'product-owner',
      approvedAt: '2026-08-28T08:00:00.000Z',
      expiresAt: '2026-08-28T09:00:00.000Z',
      permittedTestIds: ['synthetic-core'],
    },
    runner: {
      kind: 'playwright',
      specPath: DEPLOYED_CRITICAL_JOURNEY_SPEC,
      specSha256: deps.sha256('deployed-spec'),
      playwrightConfigSha256: deps.sha256('playwright-config'),
      packageVersion: '1.55.0',
      project: 'deployed-critical',
      browserName: 'chromium',
      browserVersion: '140.0.7339.16',
      attempts: 1,
      retries: 0,
      workers: 1,
    },
    results: [
      {
        testId: 'synthetic-core',
        title: 'synthetic core journey',
        outcome: 'passed',
        durationMs: 1_000,
      },
    ],
    cleanup: {
      attempted: true,
      completed: true,
      orphanedSyntheticResources: 0,
      reportSha256: deps.sha256('cleanup-report'),
    },
    redaction: {
      reportSha256: deps.sha256('redacted-report'),
      prohibitedFieldOccurrences: 0,
      unexpectedExternalRequests: 0,
    },
    outcome: 'passed',
    failures: [],
  }
  return {
    content: canonicalDeployedCriticalJourneyEvidence(evidence),
    dependencies: deps.dependencies,
  }
}

function canary(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.canary_window')
  const signals = [
    ['application-health', 'application_health'],
    ['error-rate', 'error_rate'],
    ['external-availability', 'external_availability'],
    ['latency', 'latency'],
    ['platform-recovery', 'platform_recovery'],
    ['privacy', 'privacy'],
    ['provider-controls', 'provider_controls'],
    ['queue-outbox', 'queue_outbox'],
    ['release-drift', 'release_drift'],
  ] as const
  const evidence: CanaryWindowEvidence = {
    version: CANARY_WINDOW_EVIDENCE_VERSION,
    evidenceKind: 'canary-window',
    candidate,
    runId: '40000000-0000-4000-8000-000000000003',
    startedAt: '2026-08-28T08:40:00.000Z',
    completedAt: '2026-08-28T08:50:00.000Z',
    capturedAt: '2026-08-28T08:51:00.000Z',
    profile: {
      version: CANARY_THRESHOLD_PROFILE_VERSION,
      durationMs: 600_000,
      approvedBy: 'operations-owner',
      approvedAt: '2026-08-28T08:00:00.000Z',
      decisionRecordSha256: deps.sha256('threshold-decision'),
      signals: signals.map(([name, category]) => ({
        category,
        name,
        source: (
          {
            application_health: 'application_metrics',
            error_rate: 'sentry',
            external_availability: 'external_synthetic',
            latency: 'application_metrics',
            platform_recovery: 'railway_platform',
            privacy: 'application_metrics',
            provider_controls: 'provider_control',
            queue_outbox: 'application_metrics',
            release_drift: 'release_controller',
          } as const
        )[category],
        comparator: 'lte',
        threshold: 0,
        unit: 'breaches',
        sampleIntervalMs: 60_000,
        thresholdAuthoritySha256: deps.sha256(`${name}-threshold`),
      })),
    },
    observations: signals.map(([name]) => ({
      name,
      expectedSamples: 10,
      observedSamples: 10,
      missingSamples: 0,
      breachCount: 0,
      firstSampleAt: '2026-08-28T08:40:00.000Z',
      lastSampleAt: '2026-08-28T08:49:00.000Z',
      sourceArtifactSha256: deps.sha256(`${name}-source`),
      sampleBindingSha256: deps.sha256(`${name}-binding`),
    })),
    continuity: {
      releaseIdentityMismatches: 0,
      configurationHeadMismatches: 0,
      observerReadErrors: 0,
      configurationHeadSha256: deps.sha256('configuration-head'),
    },
    attempts: 1,
    retries: 0,
    outcome: 'passed',
    failures: [],
  }
  return {
    content: canonicalCanaryWindowEvidence(evidence),
    dependencies: deps.dependencies,
  }
}

function recovery(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.restore_rollback')
  const evidence: RecoveryRehearsalEvidence = {
    version: RECOVERY_REHEARSAL_EVIDENCE_VERSION,
    evidenceKind: 'recovery-rehearsal',
    candidate,
    rehearsalRunId: '40000000-0000-4000-8000-000000000004',
    startedAt: '2026-08-28T09:00:00.000Z',
    completedAt: '2026-08-28T09:30:00.000Z',
    capturedAt: '2026-08-28T09:31:00.000Z',
    operator: {
      identity: 'operator',
      changeRecord: 'CHG-REL-01',
      independentReviewer: 'reviewer',
      reviewedAt: '2026-08-28T08:00:00.000Z',
    },
    compatibilityDecision: deps.reference('compatibility-decision'),
    containment: {
      customerTrafficStopped: true,
      mutationsStopped: true,
      workersStopped: true,
      externalEffectsStopped: true,
      evidence: deps.reference('containment'),
    },
    reverseDdlExecuted: false,
    attempts: 1,
    recoveryPath: 'compatible_image_rollback',
    schemaBackwardCompatible: true,
    priorRelease: {
      manifestSha256: deps.sha256('prior-manifest'),
      signatureBundle: deps.reference('prior-signature'),
      fullCandidatePlan: deps.reference('prior-plan'),
      reviewedPlanApproval: deps.reference('prior-plan-approval'),
      migrationAuthoritySettlement: deps.reference('migration-settlement'),
      exactDigestReadback: deps.reference('digest-readback'),
    },
    verification: {
      postRollbackJourneys: deps.reference('post-rollback-journeys'),
      releaseIdentityConsistent: true,
      queueOutboxConsistent: true,
      committedDataLossCount: 0,
      duplicateExternalEffectCount: 0,
      unsafeExternalEffectCount: 0,
    },
    outcome: 'passed',
    failures: [],
  }
  return {
    content: canonicalRecoveryRehearsalEvidence(evidence),
    dependencies: deps.dependencies,
  }
}

export function gateFLiveEvidenceFixtures(
  candidate: ReleaseCandidateBinding,
): Readonly<Record<string, GateFLiveEvidenceFixture>> {
  return {
    'promotion.deployed_critical_journeys': deployed(candidate),
    'promotion.canary_window': canary(candidate),
    'promotion.restore_rollback': recovery(candidate),
    ...remainingGateFTypedFixtures(candidate),
  }
}

// ── REL-01-T6/T5: the fifteen remaining typed Gate F keys ────────────────
//
// Every fixture below is produced by the REAL schema types, so a producer
// whose rules change breaks these fixtures instead of silently accepting a
// weaker artifact. The dependency recorder writes the source/report artifacts
// each proof claims, so the gate genuinely retains what its evidence cites.

const LIVE_CAPTURED_AT = '2026-08-28T09:00:00.000Z'
const LIVE_EXPIRES_AT = '2026-09-28T00:00:00.000Z'

function liveCommon(
  candidate: ReleaseCandidateBinding,
  deps: ReturnType<typeof dependencyRecorder>,
) {
  return {
    candidate,
    capturedAt: LIVE_CAPTURED_AT,
    expiresAt: LIVE_EXPIRES_AT,
    authority: {
      capturedBy: 'release-operator',
      attestedBy: 'release-reviewer',
      changeRecord: 'CHG-REL-01-001',
      sourceArtifactSha256: deps.sha256('source'),
    },
    redaction: {
      reportSha256: deps.sha256('redaction-report'),
      prohibitedFieldOccurrences: 0,
      unexpectedExternalRequests: 0,
    },
    outcome: 'passed' as const,
    failures: [],
  }
}

function cleanCi(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('candidate.clean_ci')
  const evidence: CleanCiRunEvidence = {
    version: CLEAN_CI_RUN_EVIDENCE_VERSION,
    evidenceKind: 'clean-ci-run',
    ...liveCommon(candidate, deps),
    workflowRef: RELEASE_IMAGES_WORKFLOW_REF,
    workflowRunId: '1234567890',
    workflowRunUrl:
      'https://github.com/kodes-agency/reputation-key/actions/runs/1234567890',
    runAttempt: 1,
    headSha: candidate.releaseSha,
    startedAt: '2026-08-28T07:00:00.000Z',
    completedAt: '2026-08-28T07:40:00.000Z',
    jobs: [
      { name: 'check', required: true, conclusion: 'success' },
      { name: 'unit', required: true, conclusion: 'success' },
      { name: 'integration', required: true, conclusion: 'success' },
      { name: 'e2e', required: true, conclusion: 'success' },
      { name: 'release-images', required: true, conclusion: 'success' },
      { name: 'optional-preview', required: false, conclusion: 'skipped' },
    ],
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function independentReview(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('candidate.independent_review')
  const evidence: IndependentReviewEvidence = {
    version: INDEPENDENT_REVIEW_EVIDENCE_VERSION,
    evidenceKind: 'independent-review',
    ...liveCommon(candidate, deps),
    reviewerIdentity: 'independent-reviewer',
    reviewedSha: candidate.releaseSha,
    reviewedAt: '2026-08-28T07:50:00.000Z',
    changes: [
      {
        reference: 'PR-4821',
        headSha: candidate.releaseSha,
        authorIdentity: 'release-engineer',
        approvedAt: '2026-08-28T07:50:00.000Z',
      },
    ],
    unresolvedComments: 0,
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function defectDisposition(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('candidate.defect_disposition')
  const evidence: DefectDispositionEvidence = {
    version: DEFECT_DISPOSITION_EVIDENCE_VERSION,
    evidenceKind: 'defect-disposition',
    ...liveCommon(candidate, deps),
    registerSha256: deps.sha256('defect-register'),
    defects: [
      {
        id: 'DEF-1',
        title: 'portal empty-state copy is stale',
        severity: 'low',
        protectedSurfaceReachable: false,
        disposition: 'deferred',
        decidedBy: 'product-owner',
        decidedAt: '2026-08-28T07:55:00.000Z',
        rationale: 'cosmetic; no protected surface reachable',
        deferredToRelease: 'beta-rc-2',
      },
      {
        id: 'DEF-2',
        title: 'reply publish retry logged twice',
        severity: 'medium',
        protectedSurfaceReachable: true,
        disposition: 'fixed_in_candidate',
        decidedBy: 'release-engineer',
        decidedAt: '2026-08-28T07:56:00.000Z',
        rationale: 'fixed and covered by a regression test',
        deferredToRelease: null,
      },
    ],
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function isolatedRestore(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('preproduction.isolated_restore_migration')
  const evidence: IsolatedRestoreMigrationEvidence = {
    version: ISOLATED_RESTORE_MIGRATION_EVIDENCE_VERSION,
    evidenceKind: 'isolated-restore-migration',
    ...liveCommon(candidate, deps),
    startedAt: '2026-08-28T06:00:00.000Z',
    completedAt: '2026-08-28T06:30:00.000Z',
    restore: {
      backupReceiptSha256: deps.sha256('restore-receipt'),
      backupTakenAt: '2026-08-28T05:00:00.000Z',
      restoredRowCount: 184_302,
    },
    isolation: {
      targetIsProductionDatabase: false,
      targetProjectId: 'railway-project-us-restore-rehearsal',
      targetEnvironmentId: 'railway-environment-restore-rehearsal',
      externalEffectsBlocked: true,
    },
    migration: {
      fromHeadTag: '0167_prior_head',
      toHeadTag: '0168_identity_organization_lifecycle_receipts',
      journalSha256: deps.sha256('journal'),
      appliedCount: 1,
      destructiveStatementCount: 0,
      compatibilityMirrorsRetained: true,
      durationMs: 42_000,
    },
    verification: {
      postMigrationDriftCount: 0,
      orphanedRowCount: 0,
      reportSha256: deps.sha256('restore-verification'),
      summary: 'restored snapshot migrated to head with no drift',
    },
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function preproductionJourneys(
  candidate: ReleaseCandidateBinding,
  gateId: keyof typeof PREPRODUCTION_JOURNEY_GATE_CLASS,
): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder(gateId)
  const journeyClass = PREPRODUCTION_JOURNEY_GATE_CLASS[gateId]
  const evidence: PreproductionJourneyEvidence = {
    version: PREPRODUCTION_JOURNEY_EVIDENCE_VERSION,
    evidenceKind: 'preproduction-journeys',
    ...liveCommon(candidate, deps),
    journeyClass,
    providerMode: 'stub',
    environmentClass: 'preproduction',
    startedAt: '2026-08-28T06:40:00.000Z',
    completedAt: '2026-08-28T06:55:00.000Z',
    runner: {
      kind: 'playwright',
      specSha256: deps.sha256('spec'),
      packageVersion: '1.55.0',
      attempts: 1,
      retries: 0,
    },
    results: [
      {
        journeyId: `${journeyClass}-core`,
        title: `${journeyClass} core journey`,
        outcome: 'passed',
        durationMs: 4_500,
      },
    ],
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function liveProviderMatrix(
  candidate: ReleaseCandidateBinding,
): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('preproduction.live_provider_journeys')
  const evidence: LiveProviderMatrixEvidence = {
    version: LIVE_PROVIDER_MATRIX_EVIDENCE_VERSION,
    evidenceKind: 'live-provider-matrix',
    ...liveCommon(candidate, deps),
    providerMode: 'live',
    provider: 'google_business_profile',
    startedAt: '2026-08-28T07:00:00.000Z',
    completedAt: '2026-08-28T07:30:00.000Z',
    account: {
      providerAccountRef: 'gbp-account-rehearsal-01',
      consentArtifactSha256: deps.sha256('provider-consent'),
      approvedBy: 'product-owner',
      approvedAt: '2026-08-27T09:00:00.000Z',
    },
    egress: {
      gatewayAttestationSha256: deps.sha256('gateway-attestation'),
      offGatewayRequestCount: 0,
      summary: 'all provider traffic left through google-egress-gateway',
    },
    surfaces: LIVE_PROVIDER_SURFACES.map((surface) => ({
      surface,
      requestCount: 3,
      providerErrorCount: 0,
      quotaExhaustedCount: 0,
      outcome: 'passed' as const,
      observedAt: '2026-08-28T07:20:00.000Z',
    })),
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function telemetryInspection(
  candidate: ReleaseCandidateBinding,
): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('preproduction.observability_content_inspection')
  const evidence: TelemetryContentInspectionEvidence = {
    version: TELEMETRY_CONTENT_INSPECTION_EVIDENCE_VERSION,
    evidenceKind: 'telemetry-content-inspection',
    ...liveCommon(candidate, deps),
    inspectedFieldClasses: [...TELEMETRY_PROHIBITED_FIELD_CLASSES],
    sinks: TELEMETRY_INSPECTED_SINKS.map((sink) => ({
      sink,
      exportSha256: deps.sha256(`${sink}-export`),
      inspectedRecordCount: 500,
      prohibitedFieldOccurrences: 0,
      windowStartedAt: '2026-08-28T06:00:00.000Z',
      windowEndedAt: '2026-08-28T08:00:00.000Z',
      summary: `${sink} export carried no prohibited field class`,
    })),
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function backupPitr(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.backup_pitr')
  const evidence: BackupPitrReceiptEvidence = {
    version: BACKUP_PITR_RECEIPT_EVIDENCE_VERSION,
    evidenceKind: 'backup-pitr-receipt',
    ...liveCommon(candidate, deps),
    source: 'platform_receipt',
    platform: 'railway',
    promotionAt: '2026-08-28T08:20:00.000Z',
    receipt: {
      receiptId: 'railway-backup-receipt-2026-08-28',
      receiptSha256: deps.sha256('platform-receipt'),
      exportedAt: '2026-08-28T08:30:00.000Z',
      databaseServiceId: 'railway-service-postgres',
      projectId: candidate.projectId,
      environmentId: candidate.environmentId,
    },
    backup: {
      snapshotId: 'railway-snapshot-2026-08-28-0700',
      takenAt: '2026-08-28T07:00:00.000Z',
      sizeBytes: 4_294_967_296,
      restoreVerifiedAt: '2026-08-28T07:45:00.000Z',
      restoreVerificationSha256: deps.sha256('restore-verification'),
    },
    pitrWindow: {
      earliestRestorableAt: '2026-08-21T00:00:00.000Z',
      latestRestorableAt: '2026-08-28T08:30:00.000Z',
      walArchivingEnabled: true,
      summary: 'seven-day WAL archive covering the promotion timestamp',
    },
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function cohortReadiness(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('opening.cohort_readiness')
  const evidence: CohortReadinessEvidence = {
    version: COHORT_READINESS_EVIDENCE_VERSION,
    evidenceKind: 'cohort-readiness',
    ...liveCommon(candidate, deps),
    kind: 'design_partner',
    cohortReference: 'design-partner-9f3c17ab',
    cohortReferenceSha256: deps.sha256('cohort-reference'),
    pseudonymMappingCustodian: 'founder',
    organizationCount: 1,
    seatCount: 8,
    supportOwner: 'support-owner',
    incidentOwner: 'incident-owner',
    changeRecord: 'CHG-REL-01-001',
    openingWindow: {
      opensAt: '2026-08-29T09:00:00.000Z',
      reviewAt: '2026-09-12T09:00:00.000Z',
    },
    checks: COHORT_READINESS_CHECKS.map((name) => ({
      name,
      satisfied: true,
      evidenceSha256: deps.sha256(`check-${name}`),
    })),
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function readbackCommon(candidate: ReleaseCandidateBinding) {
  return {
    version: PROMOTION_READBACK_EVIDENCE_VERSION,
    evidenceKind: 'promotion-readback' as const,
    candidate,
    capturedAt: '2026-08-28T09:10:00.000Z',
    observedBy: 'release-operator',
    readbackMode: 'verify_only' as const,
    outcome: 'passed' as const,
    failures: [],
  }
}

const READBACK_DEPLOYMENT_IDS = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000005',
  '50000000-0000-4000-8000-000000000006',
  '50000000-0000-4000-8000-000000000007',
] as const

function railwayNoDrift(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.railway_no_drift')
  const evidence: PromotionReadbackEvidence = {
    ...readbackCommon(candidate),
    gate: 'railway_no_drift',
    planEvidence: {
      version: RAILWAY_PLAN_EVIDENCE_VERSION,
      sha256: deps.sha256('railway-plan-evidence'),
      outcome: 'no-drift',
      capturedAt: '2026-08-28T08:10:00.000Z',
    },
    liveGraph: {
      confirmedAt: '2026-08-28T09:05:00.000Z',
      changedServiceCount: 0,
      unmanagedServiceCount: 0,
      iacSha256: releaseEvidenceSha256('iac\n'),
      releaseControllerSha256: releaseEvidenceSha256('controller\n'),
    },
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function releaseIdentityHealth(
  candidate: ReleaseCandidateBinding,
): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.release_identity_health_controls')
  const evidence: PromotionReadbackEvidence = {
    ...readbackCommon(candidate),
    gate: 'release_identity_health_controls',
    services: PROMOTION_READBACK_SERVICES.map((service, index) => ({
      service,
      releaseSha: candidate.releaseSha,
      releaseManifestSha256: candidate.releaseManifestSha256,
      sourceRevisionOverride: '' as const,
      imageSourceRevisionOverride: '' as const,
      activeDeploymentId: READBACK_DEPLOYMENT_IDS[index] ?? READBACK_DEPLOYMENT_IDS[0],
      activeImageDigest: `sha256:${releaseEvidenceSha256(`${service}\n`)}`,
    })),
    health: {
      url: `${candidate.appOrigin}/api/health`,
      httpStatus: 200,
      status: 'ok',
      probes: { db: true, redis: true, migrations: true, policy: true },
    },
    aiControlHeads: [
      {
        scopeKey: 'global',
        executionState: 'enabled',
        admissionState: 'accepting',
      },
    ],
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function migrationIntegrity(
  candidate: ReleaseCandidateBinding,
): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.migration_integrity')
  const evidence: PromotionReadbackEvidence = {
    ...readbackCommon(candidate),
    gate: 'migration_integrity',
    drizzle: {
      journalPath: 'drizzle/meta/_journal.json',
      journalSha256: deps.sha256('journal'),
      headTag: '0168_identity_organization_lifecycle_receipts',
      entryCount: 169,
    },
    schemaMigrator: {
      service: 'schema-migrator',
      deploymentId: '50000000-0000-4000-8000-0000000000aa',
      deploymentStatus: 'SUCCESS',
      imageDigest: `sha256:${releaseEvidenceSha256('schema-migrator\n')}`,
      appliedHeadTag: '0168_identity_organization_lifecycle_receipts',
      settledAt: '2026-08-28T08:15:00.000Z',
    },
    destructiveStatementCount: 0,
    compatibilityMirrorsRetained: true,
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

function dormantCellDenial(candidate: ReleaseCandidateBinding): GateFLiveEvidenceFixture {
  const deps = dependencyRecorder('promotion.dormant_cell_denial')
  const evidence: PromotionReadbackEvidence = {
    ...readbackCommon(candidate),
    gate: 'dormant_cell_denial',
    observations: DORMANT_DATA_CELL_IDS.map((cell) => ({
      cell,
      refusal: 'catalogue_state_denied' as const,
      probe: `railway environment resolve cell-${cell}`,
      resolved: false as const,
      observedAt: '2026-08-28T09:06:00.000Z',
      observationSha256: deps.sha256(`dormant-${cell}`),
    })),
  }
  return { content: canonicalReleaseEvidence(evidence), dependencies: deps.dependencies }
}

/** The fifteen Gate F keys added by REL-01-T5 and REL-01-T6. */
export function remainingGateFTypedFixtures(
  candidate: ReleaseCandidateBinding,
): Readonly<Record<string, GateFLiveEvidenceFixture>> {
  return {
    'candidate.clean_ci': cleanCi(candidate),
    'candidate.independent_review': independentReview(candidate),
    'candidate.defect_disposition': defectDisposition(candidate),
    'preproduction.isolated_restore_migration': isolatedRestore(candidate),
    'preproduction.provider_stub_journeys': preproductionJourneys(
      candidate,
      'preproduction.provider_stub_journeys',
    ),
    'preproduction.live_provider_journeys': liveProviderMatrix(candidate),
    'preproduction.portal_privacy': preproductionJourneys(
      candidate,
      'preproduction.portal_privacy',
    ),
    'preproduction.manager_journeys': preproductionJourneys(
      candidate,
      'preproduction.manager_journeys',
    ),
    'preproduction.observability_content_inspection': telemetryInspection(candidate),
    'promotion.railway_no_drift': railwayNoDrift(candidate),
    'promotion.backup_pitr': backupPitr(candidate),
    'promotion.migration_integrity': migrationIntegrity(candidate),
    'promotion.release_identity_health_controls': releaseIdentityHealth(candidate),
    'promotion.dormant_cell_denial': dormantCellDenial(candidate),
    'opening.cohort_readiness': cohortReadiness(candidate),
  }
}
