import { z } from 'zod/v4'
import {
  canonicalReleaseEvidence,
  parseCanonicalReleaseEvidence,
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'

export const RECOVERY_REHEARSAL_EVIDENCE_VERSION = 'repkey-recovery-rehearsal-1' as const
export const RECOVERY_RPO_TARGET_MS = 15 * 60 * 1000
export const RECOVERY_RTO_TARGET_MS = 4 * 60 * 60 * 1000

const referenceSchema = z
  .object({
    sha256: releaseEvidenceSha256Schema,
    capturedAt: releaseEvidenceTimestampSchema,
  })
  .strict()

const commonSchema = z
  .object({
    version: z.literal(RECOVERY_REHEARSAL_EVIDENCE_VERSION),
    evidenceKind: z.literal('recovery-rehearsal'),
    candidate: releaseCandidateBindingSchema,
    rehearsalRunId: z.uuid(),
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    capturedAt: releaseEvidenceTimestampSchema,
    operator: z
      .object({
        identity: releaseEvidenceIdentitySchema,
        changeRecord: releaseEvidenceIdentitySchema,
        independentReviewer: releaseEvidenceIdentitySchema,
        reviewedAt: releaseEvidenceTimestampSchema,
      })
      .strict(),
    compatibilityDecision: referenceSchema,
    containment: z
      .object({
        customerTrafficStopped: z.literal(true),
        mutationsStopped: z.literal(true),
        workersStopped: z.literal(true),
        externalEffectsStopped: z.literal(true),
        evidence: referenceSchema,
      })
      .strict(),
    reverseDdlExecuted: z.literal(false),
    attempts: z.literal(1),
    outcome: z.enum(['passed', 'failed']),
    failures: z.array(z.string().trim().min(1).max(1024)),
  })
  .strict()

const compatibleImageRollbackSchema = commonSchema.extend({
  recoveryPath: z.literal('compatible_image_rollback'),
  schemaBackwardCompatible: z.literal(true),
  priorRelease: z
    .object({
      manifestSha256: releaseEvidenceSha256Schema,
      signatureBundle: referenceSchema,
      fullCandidatePlan: referenceSchema,
      reviewedPlanApproval: referenceSchema,
      migrationAuthoritySettlement: referenceSchema,
      exactDigestReadback: referenceSchema,
    })
    .strict(),
  verification: z
    .object({
      postRollbackJourneys: referenceSchema,
      releaseIdentityConsistent: z.boolean(),
      queueOutboxConsistent: z.boolean(),
      committedDataLossCount: z.number().int().safe().nonnegative(),
      duplicateExternalEffectCount: z.number().int().safe().nonnegative(),
      unsafeExternalEffectCount: z.number().int().safe().nonnegative(),
    })
    .strict(),
})

const redisIdentitySchema = z
  .object({
    serviceId: releaseEvidenceIdentitySchema,
    createdAt: releaseEvidenceTimestampSchema,
    emptyState: referenceSchema,
  })
  .strict()

const incompatibleDataRestoreSchema = commonSchema.extend({
  recoveryPath: z.literal('incompatible_data_restore'),
  schemaBackwardCompatible: z.literal(false),
  restore: z
    .object({
      reviewedRestorePlan: referenceSchema,
      reviewedPlanApproval: referenceSchema,
      platformReceipt: referenceSchema,
      sourcePostgresServiceId: releaseEvidenceIdentitySchema,
      siblingPostgresServiceId: releaseEvidenceIdentitySchema,
      restorePointAt: releaseEvidenceTimestampSchema,
      latestCommittedAt: releaseEvidenceTimestampSchema,
      restoreStartedAt: releaseEvidenceTimestampSchema,
      readinessRecoveredAt: releaseEvidenceTimestampSchema,
      recoveryRunId: z.uuid(),
      recoveryGeneration: z.number().int().safe().positive(),
      recoveryFence: referenceSchema,
      lifecycleVerification: referenceSchema,
      migrationHeadVerification: referenceSchema,
      tenantIsolationAndCriticalReads: referenceSchema,
      freshRedis: z
        .object({
          cache: redisIdentitySchema,
          queue: redisIdentitySchema,
          provider: redisIdentitySchema,
        })
        .strict(),
    })
    .strict(),
  objectives: z
    .object({
      rpoMs: z.number().int().safe().nonnegative(),
      rtoMs: z.number().int().safe().nonnegative(),
    })
    .strict(),
  routingRehearsal: z
    .object({
      siblingCutoverPlan: referenceSchema,
      siblingReadback: referenceSchema,
      sourceRollbackPlan: referenceSchema,
      sourceReadback: referenceSchema,
      customerTrafficStoppedThroughout: z.literal(true),
      mutationsStoppedThroughout: z.literal(true),
      externalEffectsStoppedThroughout: z.literal(true),
    })
    .strict(),
  forwardRecovery: z
    .object({
      strategy: z.enum(['restored_sibling', 'forward_fix']),
      finalReleaseManifestSha256: releaseEvidenceSha256Schema,
      decision: referenceSchema,
      finalReadback: referenceSchema,
      postRecoveryJourneys: referenceSchema,
    })
    .strict(),
  verification: z
    .object({
      readinessGreen: z.boolean(),
      canaryReadPassed: z.boolean(),
      queueOutboxConsistent: z.boolean(),
      committedSourceIntegrityPassed: z.boolean(),
      alertReceipts: referenceSchema,
      committedDataLossCount: z.number().int().safe().nonnegative(),
      duplicateExternalEffectCount: z.number().int().safe().nonnegative(),
      unsafeExternalEffectCount: z.number().int().safe().nonnegative(),
    })
    .strict(),
})

type CompatibleImageRollbackEvidence = z.infer<typeof compatibleImageRollbackSchema>
type IncompatibleDataRestoreEvidence = z.infer<typeof incompatibleDataRestoreSchema>

/**
 * The rehearsal clock must run review → compatibility decision → start →
 * completion → capture. Anything else means the record was assembled after the
 * fact rather than observed.
 */
function refineRehearsalTiming(
  value: Readonly<{
    capturedAt: string
    operator: Readonly<{ reviewedAt: string }>
    compatibilityDecision: Readonly<{ capturedAt: string }>
  }>,
  startedAt: number,
  completedAt: number,
  context: z.RefinementCtx,
): void {
  if (completedAt < startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'completion predates rehearsal start',
    })
  }
  if (Date.parse(value.capturedAt) < completedAt) {
    context.addIssue({
      code: 'custom',
      path: ['capturedAt'],
      message: 'capture predates rehearsal completion',
    })
  }
  if (Date.parse(value.operator.reviewedAt) > startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['operator', 'reviewedAt'],
      message: 'independent review must precede rehearsal mutation',
    })
  }
  if (Date.parse(value.compatibilityDecision.capturedAt) > startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['compatibilityDecision', 'capturedAt'],
      message: 'compatibility decision must precede rehearsal mutation',
    })
  }
}

/** Reports issues and returns whether every rollback-path invariant held. */
function refineCompatibleImageRollback(
  value: CompatibleImageRollbackEvidence,
  startedAt: number,
  context: z.RefinementCtx,
): boolean {
  if (value.priorRelease.manifestSha256 === value.candidate.releaseManifestSha256) {
    context.addIssue({
      code: 'custom',
      path: ['priorRelease', 'manifestSha256'],
      message: 'rollback target must be a distinct prior release manifest',
    })
  }
  if (
    Date.parse(value.priorRelease.fullCandidatePlan.capturedAt) > startedAt ||
    Date.parse(value.priorRelease.reviewedPlanApproval.capturedAt) > startedAt
  ) {
    context.addIssue({
      code: 'custom',
      path: ['priorRelease'],
      message: 'reviewed rollback plan must precede rehearsal mutation',
    })
  }
  return (
    value.verification.releaseIdentityConsistent &&
    value.verification.queueOutboxConsistent &&
    value.verification.committedDataLossCount === 0 &&
    value.verification.duplicateExternalEffectCount === 0 &&
    value.verification.unsafeExternalEffectCount === 0
  )
}

/** Reports issues and returns whether every restore-path invariant held. */
function refineIncompatibleDataRestore(
  value: IncompatibleDataRestoreEvidence,
  startedAt: number,
  context: z.RefinementCtx,
): boolean {
  if (value.restore.sourcePostgresServiceId === value.restore.siblingPostgresServiceId) {
    context.addIssue({
      code: 'custom',
      path: ['restore', 'siblingPostgresServiceId'],
      message: 'restore target must be a distinct sibling Postgres service',
    })
  }
  if (
    Date.parse(value.restore.reviewedRestorePlan.capturedAt) > startedAt ||
    Date.parse(value.restore.reviewedPlanApproval.capturedAt) > startedAt
  ) {
    context.addIssue({
      code: 'custom',
      path: ['restore'],
      message: 'reviewed restore plan must precede rehearsal mutation',
    })
  }
  const redisIds = Object.values(value.restore.freshRedis).map(
    ({ serviceId }) => serviceId,
  )
  if (new Set(redisIds).size !== redisIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['restore', 'freshRedis'],
      message: 'cache, queue, and provider Redis services must be distinct',
    })
  }
  if (
    Date.parse(value.restore.latestCommittedAt) -
      Date.parse(value.restore.restorePointAt) !==
    value.objectives.rpoMs
  ) {
    context.addIssue({
      code: 'custom',
      path: ['objectives', 'rpoMs'],
      message: 'RPO must equal the measured restore-point data-loss interval',
    })
  }
  if (
    Date.parse(value.restore.readinessRecoveredAt) -
      Date.parse(value.restore.restoreStartedAt) !==
    value.objectives.rtoMs
  ) {
    context.addIssue({
      code: 'custom',
      path: ['objectives', 'rtoMs'],
      message: 'RTO must equal the measured restore-to-readiness interval',
    })
  }
  return (
    value.objectives.rpoMs <= RECOVERY_RPO_TARGET_MS &&
    value.objectives.rtoMs <= RECOVERY_RTO_TARGET_MS &&
    value.verification.readinessGreen &&
    value.verification.canaryReadPassed &&
    value.verification.queueOutboxConsistent &&
    value.verification.committedSourceIntegrityPassed &&
    value.verification.committedDataLossCount === 0 &&
    value.verification.duplicateExternalEffectCount === 0 &&
    value.verification.unsafeExternalEffectCount === 0
  )
}

const recoveryRehearsalEvidenceSchema = z
  .discriminatedUnion('recoveryPath', [
    compatibleImageRollbackSchema,
    incompatibleDataRestoreSchema,
  ])
  .superRefine((value, context) => {
    const startedAt = Date.parse(value.startedAt)
    const completedAt = Date.parse(value.completedAt)
    refineRehearsalTiming(value, startedAt, completedAt, context)

    const passing =
      value.recoveryPath === 'compatible_image_rollback'
        ? refineCompatibleImageRollback(value, startedAt, context)
        : refineIncompatibleDataRestore(value, startedAt, context)

    if (value.outcome === 'passed' && (!passing || value.failures.length !== 0)) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires every recovery invariant and zero failures',
      })
    }
    if (value.outcome === 'failed' && value.failures.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'failed outcome requires at least one failure',
      })
    }
  })

export type RecoveryRehearsalEvidence = z.infer<typeof recoveryRehearsalEvidenceSchema>

export function recoveryRehearsalDependencyDigests(
  evidence: RecoveryRehearsalEvidence,
): readonly string[] {
  const common = [
    evidence.compatibilityDecision.sha256,
    evidence.containment.evidence.sha256,
  ]
  if (evidence.recoveryPath === 'compatible_image_rollback') {
    return [
      ...common,
      evidence.priorRelease.manifestSha256,
      evidence.priorRelease.signatureBundle.sha256,
      evidence.priorRelease.fullCandidatePlan.sha256,
      evidence.priorRelease.reviewedPlanApproval.sha256,
      evidence.priorRelease.migrationAuthoritySettlement.sha256,
      evidence.priorRelease.exactDigestReadback.sha256,
      evidence.verification.postRollbackJourneys.sha256,
    ]
  }
  return [
    ...common,
    evidence.restore.reviewedRestorePlan.sha256,
    evidence.restore.reviewedPlanApproval.sha256,
    evidence.restore.platformReceipt.sha256,
    evidence.restore.recoveryFence.sha256,
    evidence.restore.lifecycleVerification.sha256,
    evidence.restore.migrationHeadVerification.sha256,
    evidence.restore.tenantIsolationAndCriticalReads.sha256,
    evidence.restore.freshRedis.cache.emptyState.sha256,
    evidence.restore.freshRedis.queue.emptyState.sha256,
    evidence.restore.freshRedis.provider.emptyState.sha256,
    evidence.routingRehearsal.siblingCutoverPlan.sha256,
    evidence.routingRehearsal.siblingReadback.sha256,
    evidence.routingRehearsal.sourceRollbackPlan.sha256,
    evidence.routingRehearsal.sourceReadback.sha256,
    evidence.forwardRecovery.finalReleaseManifestSha256,
    evidence.forwardRecovery.decision.sha256,
    evidence.forwardRecovery.finalReadback.sha256,
    evidence.forwardRecovery.postRecoveryJourneys.sha256,
    evidence.verification.alertReceipts.sha256,
  ]
}

export function canonicalRecoveryRehearsalEvidence(
  evidence: RecoveryRehearsalEvidence,
): string {
  return canonicalReleaseEvidence(evidence)
}

export function parseRecoveryRehearsalEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<RecoveryRehearsalEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: recoveryRehearsalEvidenceSchema,
    label: 'Recovery-rehearsal evidence',
  })
}
