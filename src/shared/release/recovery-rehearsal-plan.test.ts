import { describe, expect, it } from 'vitest'
import {
  assembleRecoveryRehearsalEvidence,
  buildRecoveryRehearsalPlan,
  recoveryRehearsalTransition,
  RECOVERY_REHEARSAL_PHASES,
  type RecoveryRehearsalAuthorization,
} from './recovery-rehearsal-plan'
import {
  RECOVERY_RPO_TARGET_MS,
  RECOVERY_RTO_TARGET_MS,
  recoveryRehearsalDependencyDigests,
} from './recovery-rehearsal-evidence'
import { releaseEvidenceSha256 } from './candidate-bound-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'

const CANDIDATE = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  cell: 'us',
  environment: 'cell-us',
  deploymentProfile: 'production',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  projectId: 'project-id',
  environmentId: 'environment-id',
  appOrigin: 'https://us.reputationkey.app',
} as const

const OPERATOR = {
  identity: 'operating-owner:beta-oncall',
  changeRecord: 'CHG-2026-08-28-01',
  independentReviewer: 'operating-owner:platform',
  reviewedAt: '2026-08-27T12:00:00.000Z',
} as const

const REFERENCE = (seed: string) => ({
  sha256: releaseEvidenceSha256(seed),
  capturedAt: '2026-08-27T12:00:00.000Z',
})

const STARTED_AT = '2026-08-28T00:00:00.000Z'
const COMPLETED_AT = '2026-08-28T02:00:00.000Z'
const CAPTURED_AT = '2026-08-28T02:30:00.000Z'

function planInput(
  overrides: Readonly<{
    recoveryPath?: 'compatible_image_rollback' | 'incompatible_data_restore'
    additionalSteps?: ReadonlyArray<
      Readonly<{ id: string; phase: string; description: string }>
    >
  }> = {},
) {
  return {
    recoveryPath: overrides.recoveryPath ?? 'incompatible_data_restore',
    candidate: CANDIDATE,
    operator: OPERATOR,
    createdAt: '2026-08-27T13:00:00.000Z',
    ...(overrides.additionalSteps ? { additionalSteps: overrides.additionalSteps } : {}),
  } as const
}

function compatibleObservations() {
  return {
    recoveryPath: 'compatible_image_rollback',
    candidate: CANDIDATE,
    rehearsalRunId: '00000000-0000-4000-8000-000000000010',
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    capturedAt: CAPTURED_AT,
    operator: OPERATOR,
    compatibilityDecision: REFERENCE('compatibility'),
    containment: {
      customerTrafficStopped: true,
      mutationsStopped: true,
      workersStopped: true,
      externalEffectsStopped: true,
      evidence: REFERENCE('containment'),
    },
    schemaBackwardCompatible: true,
    priorRelease: {
      manifestSha256: releaseEvidenceSha256('prior-manifest'),
      signatureBundle: REFERENCE('signature'),
      fullCandidatePlan: REFERENCE('plan'),
      reviewedPlanApproval: REFERENCE('approval'),
      migrationAuthoritySettlement: REFERENCE('settlement'),
      exactDigestReadback: REFERENCE('readback'),
    },
    verification: {
      postRollbackJourneys: REFERENCE('journeys'),
      releaseIdentityConsistent: true,
      queueOutboxConsistent: true,
      committedDataLossCount: 0,
      duplicateExternalEffectCount: 0,
      unsafeExternalEffectCount: 0,
    },
  } as const
}

function redis(seed: string) {
  return {
    serviceId: `redis-${seed}`,
    createdAt: '2026-08-28T00:30:00.000Z',
    emptyState: REFERENCE(`empty-${seed}`),
  }
}

function restoreObservations(
  overrides: Readonly<{
    restorePointAt?: string
    latestCommittedAt?: string
    restoreStartedAt?: string
    readinessRecoveredAt?: string
    siblingPostgresServiceId?: string
    queueRedisId?: string
  }> = {},
) {
  return {
    recoveryPath: 'incompatible_data_restore',
    candidate: CANDIDATE,
    rehearsalRunId: '00000000-0000-4000-8000-000000000011',
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    capturedAt: CAPTURED_AT,
    operator: OPERATOR,
    compatibilityDecision: REFERENCE('compatibility'),
    containment: {
      customerTrafficStopped: true,
      mutationsStopped: true,
      workersStopped: true,
      externalEffectsStopped: true,
      evidence: REFERENCE('containment'),
    },
    schemaBackwardCompatible: false,
    restore: {
      reviewedRestorePlan: REFERENCE('restore-plan'),
      reviewedPlanApproval: REFERENCE('restore-approval'),
      platformReceipt: REFERENCE('platform-receipt'),
      sourcePostgresServiceId: 'postgres-source',
      siblingPostgresServiceId: overrides.siblingPostgresServiceId ?? 'postgres-sibling',
      restorePointAt: overrides.restorePointAt ?? '2026-08-28T00:05:00.000Z',
      latestCommittedAt: overrides.latestCommittedAt ?? '2026-08-28T00:10:00.000Z',
      restoreStartedAt: overrides.restoreStartedAt ?? '2026-08-28T00:15:00.000Z',
      readinessRecoveredAt: overrides.readinessRecoveredAt ?? '2026-08-28T01:15:00.000Z',
      recoveryRunId: '00000000-0000-4000-8000-000000000012',
      recoveryGeneration: 2,
      recoveryFence: REFERENCE('fence'),
      lifecycleVerification: REFERENCE('lifecycle'),
      migrationHeadVerification: REFERENCE('migration-head'),
      tenantIsolationAndCriticalReads: REFERENCE('tenant-isolation'),
      freshRedis: {
        cache: redis('cache'),
        queue: redis(overrides.queueRedisId ?? 'queue'),
        provider: redis('provider'),
      },
    },
    routingRehearsal: {
      siblingCutoverPlan: REFERENCE('sibling-cutover'),
      siblingReadback: REFERENCE('sibling-readback'),
      sourceRollbackPlan: REFERENCE('source-rollback'),
      sourceReadback: REFERENCE('source-readback'),
      customerTrafficStoppedThroughout: true,
      mutationsStoppedThroughout: true,
      externalEffectsStoppedThroughout: true,
    },
    forwardRecovery: {
      strategy: 'restored_sibling',
      finalReleaseManifestSha256: releaseEvidenceSha256('final-manifest'),
      decision: REFERENCE('forward-decision'),
      finalReadback: REFERENCE('forward-readback'),
      postRecoveryJourneys: REFERENCE('post-recovery-journeys'),
    },
    verification: {
      readinessGreen: true,
      canaryReadPassed: true,
      queueOutboxConsistent: true,
      committedSourceIntegrityPassed: true,
      alertReceipts: REFERENCE('alerts'),
      committedDataLossCount: 0,
      duplicateExternalEffectCount: 0,
      unsafeExternalEffectCount: 0,
    },
  } as const
}

/** Every digest the evidence names, supplied with content that hashes to it. */
function dependencyFilesFor(seeds: readonly string[]) {
  return seeds.map((seed) => ({ sha256: releaseEvidenceSha256(seed), content: seed }))
}

const COMPATIBLE_SEEDS = [
  'prior-manifest',
  'compatibility',
  'containment',
  'signature',
  'plan',
  'approval',
  'settlement',
  'readback',
  'journeys',
]

const RESTORE_SEEDS = [
  'final-manifest',
  'compatibility',
  'containment',
  'restore-plan',
  'restore-approval',
  'platform-receipt',
  'fence',
  'lifecycle',
  'migration-head',
  'tenant-isolation',
  'empty-cache',
  'empty-queue',
  'empty-provider',
  'sibling-cutover',
  'sibling-readback',
  'source-rollback',
  'source-readback',
  'forward-decision',
  'forward-readback',
  'post-recovery-journeys',
  'alerts',
]

function authorizationFor(planSha256: string): RecoveryRehearsalAuthorization {
  return {
    planSha256,
    operator: OPERATOR.identity,
    reason: 'REL-01 rehearsal of the incompatible-data restore path',
    approvedAt: '2026-08-27T23:00:00.000Z',
  }
}

describe('recovery rehearsal plan', () => {
  it('declares the plan → authorize → contain → execute → read-back → emit machine', () => {
    expect([...RECOVERY_REHEARSAL_PHASES]).toEqual([
      'plan',
      'authorize',
      'contain',
      'execute',
      'read-back',
      'emit',
    ])
  })

  it('advances one phase at a time and refuses to skip a phase', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const authorization = authorizationFor(built.digest)

    let phase: (typeof RECOVERY_REHEARSAL_PHASES)[number] = 'plan'
    for (const next of RECOVERY_REHEARSAL_PHASES.slice(1)) {
      const step = recoveryRehearsalTransition({
        from: phase,
        to: next,
        planSha256: built.digest,
        authorization,
      })
      expect(step.ok, `${phase} → ${next}`).toBe(true)
      if (!step.ok) return
      phase = step.phase
    }
    expect(phase).toBe('emit')

    const skipped = recoveryRehearsalTransition({
      from: 'plan',
      to: 'execute',
      planSha256: built.digest,
      authorization,
    })
    expect(skipped.ok).toBe(false)
  })

  it('makes execute unreachable without an authorization bound to the plan digest', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const unauthorized = recoveryRehearsalTransition({
      from: 'contain',
      to: 'execute',
      planSha256: built.digest,
    })
    expect(unauthorized.ok).toBe(false)
    if (unauthorized.ok) return
    expect(unauthorized.errors.join('\n')).toContain('authorization')

    const wrongDigest = recoveryRehearsalTransition({
      from: 'contain',
      to: 'execute',
      planSha256: built.digest,
      authorization: authorizationFor('f'.repeat(64)),
    })
    expect(wrongDigest.ok).toBe(false)
    if (wrongDigest.ok) return
    expect(wrongDigest.errors.join('\n')).toContain(built.digest)
  })

  it('rejects any plan step that names reverse DDL', () => {
    for (const description of [
      'DROP COLUMN properties.legacy_region',
      'alter table reviews drop column body',
      'DROP TABLE outbox_events',
      'truncate policy_decision_audit',
      'apply the reverse DDL for migration 0042',
    ]) {
      const built = buildRecoveryRehearsalPlan(
        planInput({
          additionalSteps: [{ id: 'operator-step', phase: 'execute', description }],
        }),
      )
      expect(built.ok, description).toBe(false)
      if (built.ok) continue
      expect(built.errors.join('\n')).toMatch(/reverse DDL|destructive/u)
    }
  })

  it('emits evidence that always records reverseDdlExecuted: false', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations(),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok, assembled.ok ? '' : assembled.errors.join('\n')).toBe(true)
    if (!assembled.ok) return
    expect(assembled.evidence.reverseDdlExecuted).toBe(false)
    expect(assembled.evidence.outcome).toBe('passed')
  })

  it('refuses a rollback target identical to the candidate manifest', () => {
    const built = buildRecoveryRehearsalPlan(
      planInput({ recoveryPath: 'compatible_image_rollback' }),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const observations = compatibleObservations()
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: {
        ...observations,
        priorRelease: {
          ...observations.priorRelease,
          manifestSha256: CANDIDATE.releaseManifestSha256,
        },
      },
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(COMPATIBLE_SEEDS),
    })
    expect(assembled.ok).toBe(false)
    if (assembled.ok) return
    expect(assembled.errors.join('\n')).toContain('distinct prior release manifest')
  })

  it('refuses a restore into the source Postgres service', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations({ siblingPostgresServiceId: 'postgres-source' }),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok).toBe(false)
    if (assembled.ok) return
    expect(assembled.errors.join('\n')).toContain('distinct sibling Postgres service')
  })

  it('refuses duplicate cache, queue, or provider Redis identities', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations({ queueRedisId: 'cache' }),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok).toBe(false)
    if (assembled.ok) return
    expect(assembled.errors.join('\n')).toContain('must be distinct')
  })

  it('computes RPO and RTO from the measured restore timestamps', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const observations = restoreObservations()
    const assembled = assembleRecoveryRehearsalEvidence({
      observations,
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok).toBe(true)
    if (
      !assembled.ok ||
      assembled.evidence.recoveryPath !== 'incompatible_data_restore'
    ) {
      throw new Error('expected an incompatible-data restore')
    }
    expect(assembled.evidence.objectives.rpoMs).toBe(
      Date.parse(observations.restore.latestCommittedAt) -
        Date.parse(observations.restore.restorePointAt),
    )
    expect(assembled.evidence.objectives.rtoMs).toBe(
      Date.parse(observations.restore.readinessRecoveredAt) -
        Date.parse(observations.restore.restoreStartedAt),
    )
  })

  it('fails the rehearsal when RPO or RTO exceeds its target', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const breachedRpo = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations({
        restorePointAt: '2026-08-28T00:00:00.000Z',
        latestCommittedAt: new Date(
          Date.parse('2026-08-28T00:00:00.000Z') + RECOVERY_RPO_TARGET_MS + 1000,
        ).toISOString(),
      }),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(breachedRpo.ok).toBe(true)
    if (!breachedRpo.ok) return
    expect(breachedRpo.evidence.outcome).toBe('failed')
    expect(breachedRpo.evidence.failures.join('\n')).toContain('RPO')

    const breachedRto = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations({
        restoreStartedAt: '2026-08-28T00:00:00.000Z',
        readinessRecoveredAt: new Date(
          Date.parse('2026-08-28T00:00:00.000Z') + RECOVERY_RTO_TARGET_MS + 1000,
        ).toISOString(),
        // The rehearsal window must still contain the recovery.
      }),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(breachedRto.ok).toBe(true)
    if (!breachedRto.ok) return
    expect(breachedRto.evidence.outcome).toBe('failed')
    expect(breachedRto.evidence.failures.join('\n')).toContain('RTO')
  })

  it('refuses to assemble without an authorization bound to the plan digest', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations(),
      authorization: authorizationFor('e'.repeat(64)),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok).toBe(false)
    if (assembled.ok) return
    expect(assembled.errors.join('\n')).toContain('authorization')
  })

  it('returns a retained file for every dependency digest it names', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations(),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS),
    })
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    const retained = new Map(
      assembled.dependencies.map((file) => [file.sha256, file.content] as const),
    )
    for (const digest of recoveryRehearsalDependencyDigests(assembled.evidence)) {
      expect(retained.has(digest), `dependency ${digest} was not retained`).toBe(true)
    }
  })

  it('refuses to assemble when a named dependency has no retained file', () => {
    const built = buildRecoveryRehearsalPlan(planInput())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const assembled = assembleRecoveryRehearsalEvidence({
      observations: restoreObservations(),
      authorization: authorizationFor(built.digest),
      planSha256: built.digest,
      dependencyFiles: dependencyFilesFor(RESTORE_SEEDS.slice(1)),
    })
    expect(assembled.ok).toBe(false)
    if (assembled.ok) return
    expect(assembled.errors.join('\n')).toContain('no retained file')
  })
})
