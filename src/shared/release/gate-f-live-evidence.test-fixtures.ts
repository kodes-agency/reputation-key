import {
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
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
  }
}
