import { createHash } from 'node:crypto'
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiOperations, aiReviewAnalyses, eventConsumerReceipts } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '#/shared/ai-operation-profiles'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { AI_REVIEW_ANALYSIS_CONSUMER } from '../outbox-consumers'
import type { AiErrorCode } from '../../domain/errors'
import { createAiOperationIdentity, parseAiExecutionBinding } from '../../domain/rules'
import type {
  AiOperationBinding,
  AiOperationId,
  AiOperationIdentity,
} from '../../domain/types'
import type {
  AiOperationRecord,
  AiOperationRecoveryCandidate,
  AiOperationState,
  AiOperationStorePort,
} from '../../application/ports/ai-operation-store.port'

type OperationRow = typeof aiOperations.$inferSelect

const AI_ERROR_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'not_found',
  'source_too_large',
  'invalid_request',
  'text_unavailable',
  'language_not_supported',
  'idempotency_conflict',
  'operation_in_progress',
  'operation_ambiguous',
  'operation_abandoned',
  'completed_without_delivery',
  'merchant_opt_in_required',
  'capability_not_opted_in',
  'execution_suspended',
  'source_expired',
  'source_epoch_changed',
  'source_revision_changed',
  'analysis_sequence_changed',
  'reply_state_changed',
  'draft_invalidated',
  'property_profile_changed',
  'routing_policy_changed',
  'provider_profile_changed',
  'capability_epoch_changed',
  'redaction_blocked',
  'quota_exhausted',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_refused',
  'output_invalid',
  'output_truncated',
  'policy_unavailable',
] satisfies readonly AiErrorCode[])

function failCorrupt(message: string): never {
  throw new Error(`Invalid durable AI operation: ${message}`)
}

function requireValue<T>(value: T | null, field: string): T {
  if (value === null) failCorrupt(`${field} is missing`)
  return value
}

function operationId(value: string): AiOperationId {
  return value as AiOperationId
}

function parseFailureCode(value: string | null): AiErrorCode | null {
  if (value === null) return null
  if (!AI_ERROR_CODES.has(value)) failCorrupt('failure code is unknown')
  return value as AiErrorCode
}

function parseState(value: string): AiOperationState {
  if (
    value !== 'pending' &&
    value !== 'executing' &&
    value !== 'succeeded_pending_delivery' &&
    value !== 'succeeded' &&
    value !== 'failed' &&
    value !== 'cancelled'
  ) {
    failCorrupt('state is unknown')
  }
  return value
}

function parseIdentity(row: OperationRow): AiOperationIdentity {
  let source: unknown
  if (row.command === 'analysis') {
    source = {
      command: 'analysis',
      organizationId: requireValue(row.organizationId, 'organizationId'),
      propertyId: requireValue(row.propertyId, 'propertyId'),
      actorId: null,
      systemPrincipal: row.systemPrincipal,
      reviewId: requireValue(row.reviewId, 'reviewId'),
      originEventId: requireValue(row.originEventId, 'originEventId'),
      subjectHmac: requireValue(row.subjectHmac, 'subjectHmac'),
      subjectHmacKeyVersion: requireValue(
        row.subjectHmacKeyVersion,
        'subjectHmacKeyVersion',
      ),
      sourceEpoch: requireValue(row.sourceEpoch, 'sourceEpoch'),
      sourceRevision: requireValue(row.sourceRevision, 'sourceRevision'),
      reviewedAtEpochMillis: requireValue(
        row.reviewedAtEpochMillis,
        'reviewedAtEpochMillis',
      ),
      analysisSequence: requireValue(row.analysisSequence, 'analysisSequence'),
    }
  } else if (row.command === 'reply') {
    source = {
      command: 'reply',
      organizationId: requireValue(row.organizationId, 'organizationId'),
      propertyId: requireValue(row.propertyId, 'propertyId'),
      actorId: requireValue(row.actorUserId, 'actorUserId'),
      systemPrincipal: null,
      reviewId: requireValue(row.reviewId, 'reviewId'),
      sourceEpoch: requireValue(row.sourceEpoch, 'sourceEpoch'),
      sourceRevision: requireValue(row.sourceRevision, 'sourceRevision'),
      reviewedAtEpochMillis: requireValue(
        row.reviewedAtEpochMillis,
        'reviewedAtEpochMillis',
      ),
      tone: requireValue(row.tone, 'tone'),
      baseReplyStateRevision: requireValue(
        row.baseReplyStateRevision,
        'baseReplyStateRevision',
      ),
    }
  } else if (row.command === 'trend') {
    source = {
      command: 'trend',
      organizationId: requireValue(row.organizationId, 'organizationId'),
      propertyId: requireValue(row.propertyId, 'propertyId'),
      actorId: null,
      systemPrincipal: row.systemPrincipal,
      sourceEpoch: requireValue(row.sourceEpoch, 'sourceEpoch'),
      dueLocalDate: requireValue(row.dueLocalDate, 'dueLocalDate'),
      terminalAnalysisSequence: requireValue(
        row.terminalAnalysisSequence,
        'terminalAnalysisSequence',
      ),
      aggregateRevision: requireValue(row.aggregateRevision, 'aggregateRevision'),
    }
  } else {
    failCorrupt('command is unknown')
  }
  const parsed = createAiOperationIdentity(source)
  if (parsed.isErr()) failCorrupt(parsed.error.message)
  return parsed.value
}

function parseBinding(
  row: OperationRow,
  identity: AiOperationIdentity,
): AiOperationBinding {
  const concreteReplyLanguage =
    row.concreteReplyLanguageTag === null && row.concreteReplyTemplateGroup === null
      ? null
      : {
          tag: requireValue(row.concreteReplyLanguageTag, 'concreteReplyLanguageTag'),
          templateGroup: requireValue(
            row.concreteReplyTemplateGroup,
            'concreteReplyTemplateGroup',
          ),
        }
  const parsed = parseAiExecutionBinding({
    authorizationLineageId: requireValue(
      row.authorizationLineageId,
      'authorizationLineageId',
    ),
    noticeVersion: requireValue(row.noticeVersion, 'noticeVersion'),
    noticeDigest: requireValue(row.noticeDigest, 'noticeDigest'),
    capabilityFence: row.capabilityFences,
    sourceEpoch: requireValue(row.sourceEpoch, 'sourceEpoch'),
    evaluatedLanguage: row.evaluatedLanguage,
    concreteReplyLanguage,
    languageCatalogueDigest: row.languageCatalogueDigest,
    replyLanguageVerifierDigest: row.replyLanguageVerifierDigest,
    languageScriptConsistencyDigest: row.languageScriptConsistencyDigest,
    zhOrthographyVerifierDigest: row.zhOrthographyVerifierDigest,
    sourceRevision: row.sourceRevision,
    reviewedAtEpochMillis: row.reviewedAtEpochMillis,
    propertyProfileVersion: requireValue(
      row.propertyProfileVersion,
      'propertyProfileVersion',
    ),
    replyBrandProfileVersion: row.replyBrandProfileVersion,
    replyBrandDisplayNameDigest: row.replyBrandDisplayNameDigest,
    routingPolicyVersion: AI_ROUTING_POLICY.version,
    sourcePolicyId: requireValue(row.sourcePolicyId, 'sourcePolicyId'),
    sourceCanonicalizerDigest: requireValue(
      row.sourceCanonicalizerDigest,
      'sourceCanonicalizerDigest',
    ),
    redactionProfileVersion: requireValue(
      row.redactionProfileVersion,
      'redactionProfileVersion',
    ),
    outputLeakageProfileVersion: row.outputLeakageProfileVersion,
    outputLeakageProfileDigest: row.outputLeakageProfileDigest,
    replyTemplateCatalogueVersion: row.replyTemplateCatalogueVersion,
    replyTemplateCatalogueDigest: row.replyTemplateCatalogueDigest,
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    operationProfileVersion: operationProfile(identity.command).profileVersion,
    capabilityRuntimeProfileVersion: getAiRuntimeCapability(identity.capability)
      .runtimeProfileVersion,
    aiSubjectHmacKeyVersion: row.subjectHmacKeyVersion,
    stopFence: {
      globalControlId: row.globalControlId,
      globalGeneration: row.globalControlGeneration,
      providerControlId: row.providerControlId,
      providerGeneration: row.providerControlGeneration,
      capabilityControlId: requireValue(row.capabilityControlId, 'capabilityControlId'),
      capabilityGeneration: requireValue(
        row.capabilityControlGeneration,
        'capabilityControlGeneration',
      ),
    },
  })
  if (parsed.isErr()) failCorrupt(parsed.error.message)
  return parsed.value
}

function mapOperation(row: OperationRow): AiOperationRecord {
  const identity = parseIdentity(row)
  return {
    id: operationId(row.id),
    identity,
    binding: parseBinding(row, identity),
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    sourceProvenance:
      row.sourceDigest === null && row.sourceByteCount === null
        ? null
        : {
            digest: requireValue(row.sourceDigest, 'sourceDigest'),
            byteCount: requireValue(row.sourceByteCount, 'sourceByteCount'),
          },
    state: parseState(row.state),
    executionAttempt: row.executionAttempt,
    executionPermitId: row.executionPermitId,
    nextAttemptAtEpochMillis: row.nextAttemptAt?.getTime() ?? null,
    failureCode: parseFailureCode(row.failureCode),
    createdAtEpochMillis: row.createdAt.getTime(),
    updatedAtEpochMillis: row.updatedAt.getTime(),
    expiresAtEpochMillis: row.expiresAt.getTime(),
  }
}

function recoveryCandidate(
  operation: AiOperationRecord,
  persistedAnalysisStatus: string | null,
): AiOperationRecoveryCandidate {
  if (
    operation.state !== 'pending' &&
    operation.state !== 'executing' &&
    operation.state !== 'failed' &&
    operation.state !== 'succeeded_pending_delivery'
  ) {
    failCorrupt('recovery candidate has a settled state')
  }
  const analysis =
    operation.identity.command === 'analysis'
      ? operation.binding.capabilityFence.capability === 'review_analysis'
        ? {
            eventEnvelopeId: operation.identity.originEventId,
            organizationId: organizationId(operation.identity.organizationId),
            propertyId: propertyId(operation.identity.propertyId),
            reviewId: reviewId(operation.identity.reviewId),
            sourceEpoch: operation.identity.sourceEpoch,
            sourceRevision: operation.identity.sourceRevision,
            analysisSequence: operation.identity.analysisSequence,
            reviewAnalysisEpoch: operation.binding.capabilityFence.reviewAnalysisEpoch,
            propertyProfileVersion: operation.binding.propertyProfileVersion,
          }
        : failCorrupt('analysis recovery candidate has the wrong capability')
      : null
  const identity = {
    operationId: operation.id,
    attempt: operation.executionAttempt,
    createdAtEpochMillis: operation.createdAtEpochMillis,
    updatedAtEpochMillis: operation.updatedAtEpochMillis,
  }
  if (operation.state === 'succeeded_pending_delivery') {
    if (operation.failureCode !== null) {
      failCorrupt('completed analysis recovery candidate has a failure code')
    }
    if (analysis === null) {
      failCorrupt('completed delivery recovery candidate is not an analysis')
    }
    const resultStatus =
      persistedAnalysisStatus === null
        ? ('missing' as const)
        : persistedAnalysisStatus === 'ready' || persistedAnalysisStatus === 'unavailable'
          ? persistedAnalysisStatus
          : failCorrupt('completed analysis recovery candidate has an invalid result')
    return {
      organizationId: analysis.organizationId,
      ...identity,
      state: operation.state,
      failureCode: null,
      analysis: { ...analysis, resultStatus },
    }
  }
  return {
    organizationId: operation.identity.organizationId,
    ...identity,
    state: operation.state,
    failureCode: operation.failureCode,
    analysis,
  }
}

function assertAligned(identity: AiOperationIdentity, binding: AiOperationBinding): void {
  if (
    identity.sourceEpoch !== binding.sourceEpoch ||
    ('sourceRevision' in identity &&
      identity.sourceRevision !== binding.sourceRevision) ||
    ('reviewedAtEpochMillis' in identity &&
      identity.reviewedAtEpochMillis !== binding.reviewedAtEpochMillis) ||
    identity.capability !== binding.capabilityFence.capability
  ) {
    throw new Error('AI property identity and binding currentness differ')
  }
  if (
    identity.command === 'analysis' &&
    (identity.subjectHmacKeyVersion !== binding.aiSubjectHmacKeyVersion ||
      identity.analysisSequence < 1)
  ) {
    throw new Error('AI analysis identity and binding differ')
  }
  if (
    identity.command === 'reply' &&
    binding.capabilityFence.capability === 'reply_drafting' &&
    identity.baseReplyStateRevision !== binding.capabilityFence.baseReplyStateRevision
  ) {
    throw new Error('AI reply revision and binding differ')
  }
}

function assertSourceProvenance(
  source: Readonly<{ digest: string; byteCount: number }> | null,
): asserts source is Readonly<{ digest: string; byteCount: number }> {
  if (
    source === null ||
    !/^[0-9a-f]{64}$/.test(source.digest) ||
    !Number.isSafeInteger(source.byteCount) ||
    source.byteCount < 1 ||
    source.byteCount > 131_072
  ) {
    throw new Error('AI operation source provenance is invalid')
  }
}

function operationProfile(command: AiOperationIdentity['command']) {
  const profile = AI_OPERATION_PROFILES.find((candidate) => candidate.command === command)
  if (!profile || profile.capability === null)
    failCorrupt('operation profile is unavailable')
  return profile
}

function scopeDigest(identity: AiOperationIdentity): string {
  return createHash('sha256')
    .update(
      [identity.organizationId, identity.propertyId, identity.command].join('\0'),
      'utf8',
    )
    .digest('hex')
}

function insertionValues(
  input: Parameters<AiOperationStorePort['claim']>[0],
  idGen: () => string,
) {
  assertAligned(input.identity, input.binding)
  assertSourceProvenance(input.sourceProvenance)
  const identity = input.identity
  const binding = input.binding
  const createdAt = new Date(input.nowEpochMillis)
  const isAnalysis = identity.command === 'analysis'
  const isReply = identity.command === 'reply'
  const isTrend = identity.command === 'trend'
  const profile = operationProfile(identity.command)
  return {
    id: idGen(),
    idempotencyScope: scopeDigest(identity),
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    sourceDigest: input.sourceProvenance.digest,
    sourceByteCount: input.sourceProvenance.byteCount,
    command: identity.command,
    capability: identity.capability,
    organizationId: identity.organizationId,
    propertyId: identity.propertyId,
    actorUserId: identity.actorId,
    systemPrincipal: identity.systemPrincipal,
    reviewId: isAnalysis || isReply ? identity.reviewId : null,
    originEventId: isAnalysis ? identity.originEventId : null,
    subjectHmac: isAnalysis ? identity.subjectHmac : null,
    subjectHmacKeyVersion: isAnalysis ? identity.subjectHmacKeyVersion : null,
    sourceEpoch: identity.sourceEpoch,
    sourceRevision: isAnalysis || isReply ? identity.sourceRevision : null,
    reviewedAtEpochMillis: isAnalysis || isReply ? identity.reviewedAtEpochMillis : null,
    analysisSequence: isAnalysis ? identity.analysisSequence : null,
    tone: isReply ? identity.tone : null,
    baseReplyStateRevision: isReply ? identity.baseReplyStateRevision : null,
    dueLocalDate: isTrend ? identity.dueLocalDate : null,
    terminalAnalysisSequence: isTrend ? identity.terminalAnalysisSequence : null,
    aggregateRevision: isTrend ? identity.aggregateRevision : null,
    authorizationLineageId: binding.authorizationLineageId,
    noticeVersion: binding.noticeVersion,
    noticeDigest: binding.noticeDigest,
    evaluatedLanguage: binding.evaluatedLanguage,
    concreteReplyLanguageTag: binding.concreteReplyLanguage?.tag ?? null,
    concreteReplyTemplateGroup: binding.concreteReplyLanguage?.templateGroup ?? null,
    languageCatalogueDigest: binding.languageCatalogueDigest,
    replyLanguageVerifierDigest: binding.replyLanguageVerifierDigest,
    languageScriptConsistencyDigest: binding.languageScriptConsistencyDigest,
    zhOrthographyVerifierDigest: binding.zhOrthographyVerifierDigest,
    propertyProfileVersion: binding.propertyProfileVersion,
    replyBrandProfileVersion: binding.replyBrandProfileVersion,
    replyBrandDisplayNameDigest: binding.replyBrandDisplayNameDigest,
    routingPolicyVersion: AI_ROUTING_POLICY.version,
    providerDeploymentProfileVersion: profile.providerDeploymentProfileVersion,
    operationProfileVersion: profile.profileVersion,
    capabilityRuntimeProfileVersion: profile.capabilityRuntimeProfileVersion,
    sourcePolicyId: binding.sourcePolicyId,
    sourceCanonicalizerDigest: binding.sourceCanonicalizerDigest,
    redactionProfileVersion: binding.redactionProfileVersion,
    outputLeakageProfileVersion: binding.outputLeakageProfileVersion,
    outputLeakageProfileDigest: binding.outputLeakageProfileDigest,
    replyTemplateCatalogueVersion: binding.replyTemplateCatalogueVersion,
    replyTemplateCatalogueDigest: binding.replyTemplateCatalogueDigest,
    globalControlId: binding.stopFence.globalControlId,
    globalControlGeneration: binding.stopFence.globalGeneration,
    providerControlId: binding.stopFence.providerControlId,
    providerControlGeneration: binding.stopFence.providerGeneration,
    capabilityControlId: binding.stopFence.capabilityControlId,
    capabilityControlGeneration: binding.stopFence.capabilityGeneration,
    capabilityFences: binding.capabilityFence,
    routeKey: profile.sourceRoute,
    state: 'pending',
    executionAttempt: 0,
    nextAttemptAt: createdAt,
    failureCode: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(input.expiresAtEpochMillis),
    deliveredAt: null,
  } as const
}

export const createAiOperationStoreAdapter = (
  db: Database,
  idGen: () => string,
): AiOperationStorePort => {
  return {
    async claim(input) {
      return db.transaction(async (tx) => {
        const values = insertionValues(input, idGen)
        const [inserted] = await tx
          .insert(aiOperations)
          .values(values)
          .onConflictDoNothing()
          .returning()
        if (inserted) return { status: 'created', operation: mapOperation(inserted) }

        const [existing] = await tx
          .select()
          .from(aiOperations)
          .where(
            and(
              eq(aiOperations.idempotencyScope, values.idempotencyScope),
              eq(aiOperations.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
          .for('update')
        if (!existing) failCorrupt('idempotency conflict row disappeared')
        if (existing.requestFingerprint !== input.requestFingerprint) {
          return { status: 'conflict' }
        }
        return { status: 'replayed', operation: mapOperation(existing) }
      })
    },

    async claimExecution(input) {
      return db.transaction(async (tx) => {
        const now = new Date(input.nowEpochMillis)
        const permitId = idGen()
        const [claimed] = await tx
          .update(aiOperations)
          .set({
            state: 'executing',
            executionAttempt: input.expectedAttempt,
            nextAttemptAt: null,
            failureCode: null,
            executionPermitId: permitId,
            updatedAt: now,
          })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              input.organizationId === null
                ? isNull(aiOperations.organizationId)
                : eq(aiOperations.organizationId, input.organizationId),
              eq(aiOperations.state, 'pending'),
              eq(aiOperations.executionAttempt, input.expectedAttempt - 1),
              or(
                isNull(aiOperations.nextAttemptAt),
                lte(aiOperations.nextAttemptAt, now),
              ),
              gtExpiry(now),
            ),
          )
          .returning()
        if (!claimed) return null
        return mapOperation(claimed)
      })
    },

    async recordFailure(input) {
      return db.transaction(async (tx) => {
        const expectedState = input.expectedState ?? 'executing'
        const expectedFailureCode = input.expectedFailureCode ?? null
        const [operation] = await tx
          .select({ id: aiOperations.id })
          .from(aiOperations)
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              input.organizationId === null
                ? isNull(aiOperations.organizationId)
                : eq(aiOperations.organizationId, input.organizationId),
              eq(aiOperations.state, expectedState),
              eq(aiOperations.executionAttempt, input.expectedAttempt),
              expectedFailureCode === null
                ? isNull(aiOperations.failureCode)
                : eq(aiOperations.failureCode, expectedFailureCode),
            ),
          )
          .limit(1)
          .for('update')
        if (!operation) return false
        const failedAt = new Date(input.failedAtEpochMillis)
        await tx
          .update(aiOperations)
          .set({
            state: input.retryAtEpochMillis === null ? 'failed' : 'pending',
            failureCode: input.failureCode,
            nextAttemptAt:
              input.retryAtEpochMillis === null
                ? null
                : new Date(input.retryAtEpochMillis),
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              input.organizationId === null
                ? isNull(aiOperations.organizationId)
                : eq(aiOperations.organizationId, input.organizationId),
            ),
          )
        return true
      })
    },

    async listExpiredExecutions(input) {
      // Selection is intentionally lock-free. The reaper terminalizes pending,
      // executing, and result-less completed rows through `recordFailure`'s
      // exact CAS. Persisted results use `markDelivered`'s exact CAS. Failed
      // analysis rows are selected only while their origin event lacks a
      // receipt, making a crash between failure and sequence advancement
      // recoverable.
      const now = new Date(input.nowEpochMillis)
      const horizonDeadline = new Date(
        input.nowEpochMillis - input.executionHorizonMillis,
      )
      const rows = await db
        .select({
          operation: aiOperations,
          receiptEventId: eventConsumerReceipts.eventId,
          persistedAnalysisStatus: aiReviewAnalyses.status,
        })
        .from(aiOperations)
        .leftJoin(
          eventConsumerReceipts,
          and(
            eq(eventConsumerReceipts.eventId, aiOperations.originEventId),
            eq(eventConsumerReceipts.consumerName, AI_REVIEW_ANALYSIS_CONSUMER),
          ),
        )
        .leftJoin(aiReviewAnalyses, eq(aiReviewAnalyses.operationId, aiOperations.id))
        .where(
          or(
            and(
              eq(aiOperations.state, 'executing'),
              or(
                lte(aiOperations.expiresAt, now),
                lte(aiOperations.updatedAt, horizonDeadline),
              ),
            ),
            and(
              eq(aiOperations.command, 'analysis'),
              eq(aiOperations.state, 'pending'),
              lte(aiOperations.createdAt, horizonDeadline),
            ),
            and(
              eq(aiOperations.command, 'analysis'),
              eq(aiOperations.state, 'succeeded_pending_delivery'),
              isNull(aiOperations.deliveredAt),
              lte(aiOperations.createdAt, horizonDeadline),
            ),
            and(
              eq(aiOperations.command, 'analysis'),
              eq(aiOperations.state, 'failed'),
              inArray(aiOperations.failureCode, [
                'completed_without_delivery',
                'language_not_supported',
                'operation_abandoned',
                'operation_ambiguous',
              ]),
              isNull(eventConsumerReceipts.eventId),
            ),
          ),
        )
        .orderBy(
          aiOperations.organizationId,
          aiOperations.propertyId,
          aiOperations.sourceEpoch,
          aiOperations.analysisSequence,
          aiOperations.updatedAt,
          aiOperations.id,
        )
        .limit(input.limit)
      return rows.map((row) =>
        recoveryCandidate(mapOperation(row.operation), row.persistedAnalysisStatus),
      )
    },

    async markDelivered(input) {
      const deliveredAt = new Date(input.deliveredAtEpochMillis)
      const rows = await db
        .update(aiOperations)
        .set({ state: 'succeeded', deliveredAt, updatedAt: deliveredAt })
        .where(
          and(
            eq(aiOperations.id, input.operationId),
            input.organizationId === null
              ? isNull(aiOperations.organizationId)
              : eq(aiOperations.organizationId, input.organizationId),
            eq(aiOperations.state, 'succeeded_pending_delivery'),
            eq(aiOperations.executionAttempt, input.expectedAttempt),
          ),
        )
        .returning({ id: aiOperations.id })
      return rows.length === 1
    },
  }
}

function gtExpiry(now: Date) {
  return gt(aiOperations.expiresAt, now)
}
