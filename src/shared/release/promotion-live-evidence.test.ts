import { describe, expect, it } from 'vitest'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  canonicalDeployedCriticalJourneyEvidence,
  DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION,
  DEPLOYED_CRITICAL_JOURNEY_SPEC,
  parseDeployedCriticalJourneyEvidence,
  type DeployedCriticalJourneyEvidence,
} from './deployed-critical-journey-evidence'
import {
  CANARY_REQUIRED_SIGNAL_CATEGORIES,
  CANARY_THRESHOLD_PROFILE_VERSION,
  CANARY_WINDOW_EVIDENCE_VERSION,
  canonicalCanaryWindowEvidence,
  parseCanaryWindowEvidence,
  type CanaryWindowEvidence,
} from './canary-window-evidence'
import {
  canonicalRecoveryRehearsalEvidence,
  parseRecoveryRehearsalEvidence,
  RECOVERY_REHEARSAL_EVIDENCE_VERSION,
  type RecoveryRehearsalEvidence,
} from './recovery-rehearsal-evidence'
import type { ReleaseCandidateBinding } from './candidate-bound-evidence'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

function candidate(): ReleaseCandidateBinding {
  return {
    releaseSha: 'a'.repeat(40),
    releaseManifestSha256: digest('b'),
    cell: 'us',
    environment: 'cell-us',
    deploymentProfile: 'production',
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    projectId: 'railway-project-us-production',
    environmentId: 'railway-environment-cell-us',
    appOrigin: 'https://us.reputationkey.app',
  }
}

function deployedJourneyEvidence(): DeployedCriticalJourneyEvidence {
  return {
    version: DEPLOYED_CRITICAL_JOURNEY_EVIDENCE_VERSION,
    evidenceKind: 'deployed-critical-journeys',
    candidate: candidate(),
    runId: '10000000-0000-4000-8000-000000000001',
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:05:00.000Z',
    capturedAt: '2026-08-28T10:06:00.000Z',
    authorization: {
      syntheticOrganizationId: '10000000-0000-4000-8000-000000000002',
      authorizationArtifactSha256: digest('c'),
      approvedBy: 'product-owner@example.com',
      approvedAt: '2026-08-28T09:00:00.000Z',
      expiresAt: '2026-08-28T11:00:00.000Z',
      permittedTestIds: ['manager-read', 'portal-read'],
    },
    runner: {
      kind: 'playwright',
      specPath: DEPLOYED_CRITICAL_JOURNEY_SPEC,
      specSha256: digest('d'),
      playwrightConfigSha256: digest('e'),
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
        testId: 'manager-read',
        title: 'manager reads the synthetic property',
        outcome: 'passed',
        durationMs: 1_000,
      },
      {
        testId: 'portal-read',
        title: 'guest reads the synthetic Portal',
        outcome: 'passed',
        durationMs: 1_500,
      },
    ],
    cleanup: {
      attempted: true,
      completed: true,
      orphanedSyntheticResources: 0,
      reportSha256: digest('f'),
    },
    redaction: {
      reportSha256: digest('1'),
      prohibitedFieldOccurrences: 0,
      unexpectedExternalRequests: 0,
    },
    outcome: 'passed',
    failures: [],
  }
}

function canaryEvidence(): CanaryWindowEvidence {
  const signalRows = [
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
  return {
    version: CANARY_WINDOW_EVIDENCE_VERSION,
    evidenceKind: 'canary-window',
    candidate: candidate(),
    runId: '20000000-0000-4000-8000-000000000001',
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:10:00.000Z',
    capturedAt: '2026-08-28T10:11:00.000Z',
    profile: {
      version: CANARY_THRESHOLD_PROFILE_VERSION,
      durationMs: 600_000,
      approvedBy: 'operations-owner@example.com',
      approvedAt: '2026-08-28T09:00:00.000Z',
      decisionRecordSha256: digest('2'),
      signals: signalRows.map(([name, category], index) => ({
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
        comparator: 'lte' as const,
        threshold: 0,
        unit: 'breaches',
        sampleIntervalMs: 60_000,
        thresholdAuthoritySha256: digest(String((index % 8) + 1)),
      })),
    },
    observations: signalRows.map(([name], index) => ({
      name,
      expectedSamples: 10,
      observedSamples: 10,
      missingSamples: 0,
      breachCount: 0,
      firstSampleAt: '2026-08-28T10:00:00.000Z',
      lastSampleAt: '2026-08-28T10:09:00.000Z',
      sourceArtifactSha256: digest(String(((index + 1) % 8) + 1)),
      sampleBindingSha256: digest(String(((index + 2) % 8) + 1)),
    })),
    continuity: {
      releaseIdentityMismatches: 0,
      configurationHeadMismatches: 0,
      observerReadErrors: 0,
      configurationHeadSha256: digest('3'),
    },
    attempts: 1,
    retries: 0,
    outcome: 'passed',
    failures: [],
  }
}

const reference = (value: string, capturedAt = '2026-08-28T09:00:00.000Z') => ({
  sha256: digest(value),
  capturedAt,
})

function recoveryEvidence(
  recoveryPath: 'compatible_image_rollback' | 'incompatible_data_restore',
): RecoveryRehearsalEvidence {
  const common = {
    version: RECOVERY_REHEARSAL_EVIDENCE_VERSION,
    evidenceKind: 'recovery-rehearsal' as const,
    candidate: candidate(),
    rehearsalRunId: '30000000-0000-4000-8000-000000000001',
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:30:00.000Z',
    capturedAt: '2026-08-28T10:31:00.000Z',
    operator: {
      identity: 'operator@example.com',
      changeRecord: 'CHG-REL-01-RECOVERY',
      independentReviewer: 'reviewer@example.com',
      reviewedAt: '2026-08-28T09:00:00.000Z',
    },
    compatibilityDecision: reference('3'),
    containment: {
      customerTrafficStopped: true as const,
      mutationsStopped: true as const,
      workersStopped: true as const,
      externalEffectsStopped: true as const,
      evidence: reference('4'),
    },
    reverseDdlExecuted: false as const,
    attempts: 1 as const,
    outcome: 'passed' as const,
    failures: [],
  }
  if (recoveryPath === 'compatible_image_rollback') {
    return {
      ...common,
      recoveryPath,
      schemaBackwardCompatible: true,
      priorRelease: {
        manifestSha256: digest('5'),
        signatureBundle: reference('6'),
        fullCandidatePlan: reference('7'),
        reviewedPlanApproval: reference('8'),
        migrationAuthoritySettlement: reference('9'),
        exactDigestReadback: reference('a'),
      },
      verification: {
        postRollbackJourneys: reference('b'),
        releaseIdentityConsistent: true,
        queueOutboxConsistent: true,
        committedDataLossCount: 0,
        duplicateExternalEffectCount: 0,
        unsafeExternalEffectCount: 0,
      },
    }
  }
  return {
    ...common,
    recoveryPath,
    schemaBackwardCompatible: false,
    restore: {
      reviewedRestorePlan: reference('b'),
      reviewedPlanApproval: reference('c'),
      platformReceipt: reference('c'),
      sourcePostgresServiceId: 'postgres-source',
      siblingPostgresServiceId: 'postgres-pitr-sibling',
      restorePointAt: '2026-08-28T09:55:00.000Z',
      latestCommittedAt: '2026-08-28T10:00:00.000Z',
      restoreStartedAt: '2026-08-28T10:00:00.000Z',
      readinessRecoveredAt: '2026-08-28T10:05:00.000Z',
      recoveryRunId: '30000000-0000-4000-8000-000000000002',
      recoveryGeneration: 2,
      recoveryFence: reference('d'),
      lifecycleVerification: reference('e'),
      migrationHeadVerification: reference('f'),
      tenantIsolationAndCriticalReads: reference('1'),
      freshRedis: {
        cache: {
          serviceId: 'redis-cache-fresh',
          createdAt: '2026-08-28T10:01:00.000Z',
          emptyState: reference('2'),
        },
        queue: {
          serviceId: 'redis-queue-fresh',
          createdAt: '2026-08-28T10:01:00.000Z',
          emptyState: reference('3'),
        },
        provider: {
          serviceId: 'redis-provider-fresh',
          createdAt: '2026-08-28T10:01:00.000Z',
          emptyState: reference('4'),
        },
      },
    },
    objectives: { rpoMs: 300_000, rtoMs: 300_000 },
    routingRehearsal: {
      siblingCutoverPlan: reference('5'),
      siblingReadback: reference('6'),
      sourceRollbackPlan: reference('7'),
      sourceReadback: reference('8'),
      customerTrafficStoppedThroughout: true,
      mutationsStoppedThroughout: true,
      externalEffectsStoppedThroughout: true,
    },
    forwardRecovery: {
      strategy: 'restored_sibling',
      finalReleaseManifestSha256: digest('9'),
      decision: reference('a'),
      finalReadback: reference('b'),
      postRecoveryJourneys: reference('c'),
    },
    verification: {
      readinessGreen: true,
      canaryReadPassed: true,
      queueOutboxConsistent: true,
      committedSourceIntegrityPassed: true,
      alertReceipts: reference('d'),
      committedDataLossCount: 0,
      duplicateExternalEffectCount: 0,
      unsafeExternalEffectCount: 0,
    },
  }
}

describe('candidate-bound live promotion evidence', () => {
  it('accepts only a canonical, authorized, no-retry deployed journey result', () => {
    const evidence = deployedJourneyEvidence()
    expect(
      parseDeployedCriticalJourneyEvidence(
        canonicalDeployedCriticalJourneyEvidence(evidence),
      ),
    ).toMatchObject({ ok: true, evidence: { outcome: 'passed' } })

    const invalid = {
      ...evidence,
      runner: { ...evidence.runner, retries: 1 },
    } as unknown as DeployedCriticalJourneyEvidence
    expect(
      parseDeployedCriticalJourneyEvidence(
        canonicalDeployedCriticalJourneyEvidence(invalid),
      ),
    ).toMatchObject({ ok: false })
  })

  it('fails a canary pass when a sample is missing or a category disappears', () => {
    const evidence = canaryEvidence()
    expect(CANARY_REQUIRED_SIGNAL_CATEGORIES).toHaveLength(9)
    expect(
      parseCanaryWindowEvidence(canonicalCanaryWindowEvidence(evidence)),
    ).toMatchObject({ ok: true, evidence: { outcome: 'passed' } })

    const observations = evidence.observations.map((row, index) =>
      index === 0 ? { ...row, observedSamples: 9, missingSamples: 1 } : row,
    )
    const invalid = { ...evidence, observations } as CanaryWindowEvidence
    const result = parseCanaryWindowEvidence(canonicalCanaryWindowEvidence(invalid))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('breach-free')
  })

  it('refuses a canary signal sourced from the wrong authority', () => {
    const evidence = canaryEvidence()
    const signals = evidence.profile.signals.map((signal) =>
      signal.category === 'error_rate'
        ? { ...signal, source: 'application_metrics' as const }
        : signal,
    )
    const invalid = {
      ...evidence,
      profile: { ...evidence.profile, signals },
    } as CanaryWindowEvidence
    const result = parseCanaryWindowEvidence(canonicalCanaryWindowEvidence(invalid))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('not authoritative')
  })

  it('accepts distinct compatible rollback and incompatible restore outcomes', () => {
    for (const recoveryPath of [
      'compatible_image_rollback',
      'incompatible_data_restore',
    ] as const) {
      const evidence = recoveryEvidence(recoveryPath)
      expect(
        parseRecoveryRehearsalEvidence(canonicalRecoveryRehearsalEvidence(evidence)),
      ).toMatchObject({
        ok: true,
        evidence: { recoveryPath, outcome: 'passed' },
      })
    }
  })

  it('refuses a same-database restore and a passing result beyond RPO', () => {
    const evidence = recoveryEvidence('incompatible_data_restore')
    if (evidence.recoveryPath !== 'incompatible_data_restore') throw new Error('fixture')
    const invalid: RecoveryRehearsalEvidence = {
      ...evidence,
      restore: {
        ...evidence.restore,
        siblingPostgresServiceId: evidence.restore.sourcePostgresServiceId,
      },
      objectives: { ...evidence.objectives, rpoMs: 900_001 },
    }
    const result = parseRecoveryRehearsalEvidence(
      canonicalRecoveryRehearsalEvidence(invalid),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('distinct sibling Postgres')
      expect(result.errors.join('\n')).toContain('every recovery invariant')
    }
  })

  it('rejects non-canonical live evidence even when its fields are valid', () => {
    expect(
      parseDeployedCriticalJourneyEvidence(
        JSON.stringify(deployedJourneyEvidence(), null, 2),
      ),
    ).toMatchObject({ ok: false })
  })
})
