import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiExecutionPermits, aiOperationAttempts, aiOperations } from '#/shared/db/schema'
import type { AiErrorCode } from '../../domain/errors'
import {
  createAiOperationIdentity,
  parseAiCanaryExecutionBinding,
  parseAiExecutionBinding,
} from '../../domain/rules'
import type {
  AiCanaryExecutionBinding,
  AiExecutionBinding,
  AiOperationBinding,
  AiOperationId,
  AiOperationIdentity,
} from '../../domain/types'
import type {
  AiOperationRecord,
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
  } else if (row.command === 'synthetic_canary') {
    source = {
      command: 'synthetic_canary',
      actorId: null,
      systemPrincipal: row.systemPrincipal,
      releaseSha: requireValue(row.releaseSha, 'releaseSha'),
      canaryAuthorizationId: requireValue(
        row.canaryAuthorizationId,
        'canaryAuthorizationId',
      ),
      canaryAuthorizationGeneration: requireValue(
        row.canaryAuthorizationGeneration,
        'canaryAuthorizationGeneration',
      ),
      canaryProfileVersion: requireValue(
        row.canaryProfileVersion,
        'canaryProfileVersion',
      ),
    }
  } else {
    failCorrupt('command is unknown')
  }
  const parsed = createAiOperationIdentity(source)
  if (parsed.isErr()) failCorrupt(parsed.error.message)
  return parsed.value
}

function parseBinding(row: OperationRow): AiOperationBinding {
  if (row.command === 'synthetic_canary') {
    const parsed = parseAiCanaryExecutionBinding({
      canaryAuthorizationId: requireValue(
        row.canaryAuthorizationId,
        'canaryAuthorizationId',
      ),
      canaryAuthorizationGeneration: requireValue(
        row.canaryAuthorizationGeneration,
        'canaryAuthorizationGeneration',
      ),
      releaseSha: requireValue(row.releaseSha, 'releaseSha'),
      canaryProfileVersion: requireValue(
        row.canaryProfileVersion,
        'canaryProfileVersion',
      ),
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
      operationProfileVersion: row.operationProfileVersion,
      stopFence: {
        globalControlId: row.globalControlId,
        globalGeneration: row.globalControlGeneration,
        providerControlId: row.providerControlId,
        providerGeneration: row.providerControlGeneration,
        allCapabilityStopFences: row.capabilityFences,
      },
    })
    if (parsed.isErr()) failCorrupt(parsed.error.message)
    return parsed.value
  }

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
    routingPolicyVersion: requireValue(row.routingPolicyVersion, 'routingPolicyVersion'),
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
    providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
    operationProfileVersion: row.operationProfileVersion,
    capabilityRuntimeProfileVersion: requireValue(
      row.capabilityRuntimeProfileVersion,
      'capabilityRuntimeProfileVersion',
    ),
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

function mapOperation(
  row: OperationRow,
  executionPermitId: string | null = null,
): AiOperationRecord {
  return {
    id: operationId(row.id),
    identity: parseIdentity(row),
    binding: parseBinding(row),
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
    executionPermitId,
    nextAttemptAtEpochMillis: row.nextAttemptAt?.getTime() ?? null,
    failureCode: parseFailureCode(row.failureCode),
    createdAtEpochMillis: row.createdAt.getTime(),
    updatedAtEpochMillis: row.updatedAt.getTime(),
    expiresAtEpochMillis: row.expiresAt.getTime(),
  }
}

function isCanaryBinding(
  binding: AiOperationBinding,
): binding is AiCanaryExecutionBinding {
  return 'canaryAuthorizationId' in binding
}

function assertAligned(identity: AiOperationIdentity, binding: AiOperationBinding): void {
  const canary = identity.command === 'synthetic_canary'
  if (canary !== isCanaryBinding(binding)) {
    throw new Error('AI operation identity and execution binding branches differ')
  }
  if (canary && isCanaryBinding(binding)) {
    if (
      identity.canaryAuthorizationId !== binding.canaryAuthorizationId ||
      identity.canaryAuthorizationGeneration !== binding.canaryAuthorizationGeneration ||
      identity.releaseSha !== binding.releaseSha ||
      identity.canaryProfileVersion !== binding.canaryProfileVersion
    ) {
      throw new Error('Synthetic canary identity and binding differ')
    }
    return
  }
  if (!canary && !isCanaryBinding(binding)) {
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
}

function assertSourceProvenance(
  identity: AiOperationIdentity,
  source: Readonly<{ digest: string; byteCount: number }> | null,
): void {
  const valid =
    source !== null &&
    /^[0-9a-f]{64}$/.test(source.digest) &&
    Number.isSafeInteger(source.byteCount) &&
    source.byteCount >= 1 &&
    source.byteCount <= 131_072
  if (
    (identity.command === 'synthetic_canary' && source !== null) ||
    (identity.command !== 'synthetic_canary' && !valid)
  ) {
    throw new Error('AI operation source provenance is invalid')
  }
}

function scopeDigest(identity: AiOperationIdentity): string {
  const scope =
    identity.command === 'synthetic_canary'
      ? ['synthetic_canary', identity.releaseSha]
      : [identity.organizationId, identity.propertyId, identity.command]
  return createHash('sha256').update(scope.join('\0'), 'utf8').digest('hex')
}

function insertionValues(input: Parameters<AiOperationStorePort['claim']>[0]) {
  assertAligned(input.identity, input.binding)
  assertSourceProvenance(input.identity, input.sourceProvenance)
  const identity = input.identity
  const canaryBinding = isCanaryBinding(input.binding) ? input.binding : null
  const propertyBinding: AiExecutionBinding | null = isCanaryBinding(input.binding)
    ? null
    : input.binding
  const createdAt = new Date(input.nowEpochMillis)
  const isAnalysis = identity.command === 'analysis'
  const isReply = identity.command === 'reply'
  const isTrend = identity.command === 'trend'
  const isCanary = identity.command === 'synthetic_canary'
  const stopFence = input.binding.stopFence

  return {
    id: randomUUID(),
    idempotencyScope: scopeDigest(identity),
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    sourceDigest: input.sourceProvenance?.digest ?? null,
    sourceByteCount: input.sourceProvenance?.byteCount ?? null,
    command: identity.command,
    capability: identity.capability,
    organizationId: isCanary ? null : identity.organizationId,
    propertyId: isCanary ? null : identity.propertyId,
    actorUserId: identity.actorId,
    systemPrincipal: identity.systemPrincipal,
    reviewId: isAnalysis || isReply ? identity.reviewId : null,
    originEventId: isAnalysis ? identity.originEventId : null,
    subjectHmac: isAnalysis ? identity.subjectHmac : null,
    subjectHmacKeyVersion: isAnalysis ? identity.subjectHmacKeyVersion : null,
    sourceEpoch: isCanary ? null : identity.sourceEpoch,
    sourceRevision: isAnalysis || isReply ? identity.sourceRevision : null,
    reviewedAtEpochMillis: isAnalysis || isReply ? identity.reviewedAtEpochMillis : null,
    analysisSequence: isAnalysis ? identity.analysisSequence : null,
    tone: isReply ? identity.tone : null,
    baseReplyStateRevision: isReply ? identity.baseReplyStateRevision : null,
    dueLocalDate: isTrend ? identity.dueLocalDate : null,
    terminalAnalysisSequence: isTrend ? identity.terminalAnalysisSequence : null,
    aggregateRevision: isTrend ? identity.aggregateRevision : null,
    releaseSha: isCanary ? identity.releaseSha : null,
    canaryAuthorizationId: isCanary ? identity.canaryAuthorizationId : null,
    canaryAuthorizationGeneration: isCanary
      ? identity.canaryAuthorizationGeneration
      : null,
    canaryProfileVersion: isCanary ? identity.canaryProfileVersion : null,
    authorizationLineageId: propertyBinding?.authorizationLineageId ?? null,
    noticeVersion: propertyBinding?.noticeVersion ?? null,
    noticeDigest: propertyBinding?.noticeDigest ?? null,
    evaluatedLanguage: propertyBinding?.evaluatedLanguage ?? null,
    concreteReplyLanguageTag: propertyBinding?.concreteReplyLanguage?.tag ?? null,
    concreteReplyTemplateGroup:
      propertyBinding?.concreteReplyLanguage?.templateGroup ?? null,
    languageCatalogueDigest: propertyBinding?.languageCatalogueDigest ?? null,
    replyLanguageVerifierDigest: propertyBinding?.replyLanguageVerifierDigest ?? null,
    languageScriptConsistencyDigest:
      propertyBinding?.languageScriptConsistencyDigest ?? null,
    zhOrthographyVerifierDigest: propertyBinding?.zhOrthographyVerifierDigest ?? null,
    propertyProfileVersion: propertyBinding?.propertyProfileVersion ?? null,
    routingPolicyVersion: propertyBinding?.routingPolicyVersion ?? null,
    sourcePolicyId: propertyBinding?.sourcePolicyId ?? null,
    sourceCanonicalizerDigest: propertyBinding?.sourceCanonicalizerDigest ?? null,
    redactionProfileVersion: propertyBinding?.redactionProfileVersion ?? null,
    outputLeakageProfileVersion: propertyBinding?.outputLeakageProfileVersion ?? null,
    outputLeakageProfileDigest: propertyBinding?.outputLeakageProfileDigest ?? null,
    replyTemplateCatalogueVersion: propertyBinding?.replyTemplateCatalogueVersion ?? null,
    replyTemplateCatalogueDigest: propertyBinding?.replyTemplateCatalogueDigest ?? null,
    providerDeploymentProfileVersion: input.binding.providerDeploymentProfileVersion,
    operationProfileVersion: input.binding.operationProfileVersion,
    capabilityRuntimeProfileVersion:
      propertyBinding?.capabilityRuntimeProfileVersion ?? null,
    globalControlId: stopFence.globalControlId,
    globalControlGeneration: stopFence.globalGeneration,
    providerControlId: stopFence.providerControlId,
    providerControlGeneration: stopFence.providerGeneration,
    capabilityControlId: propertyBinding?.stopFence.capabilityControlId ?? null,
    capabilityControlGeneration: propertyBinding?.stopFence.capabilityGeneration ?? null,
    capabilityFences:
      canaryBinding?.stopFence.allCapabilityStopFences ??
      propertyBinding?.capabilityFence ??
      null,
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

export function createAiOperationStoreAdapter(db: Database): AiOperationStorePort {
  return {
    async claim(input) {
      return db.transaction(async (tx) => {
        const values = insertionValues(input)
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

    async read(input) {
      const [row] = await db
        .select()
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.id, input.operationId),
            eq(aiOperations.command, input.command),
          ),
        )
        .limit(1)
      if (!row) return null
      let executionPermitId: string | null = null
      if (row.executionAttempt > 0) {
        const [attempt] = await db
          .select({
            executionPermitId: aiExecutionPermits.id,
          })
          .from(aiOperationAttempts)
          .leftJoin(
            aiExecutionPermits,
            and(
              eq(aiExecutionPermits.operationId, aiOperationAttempts.operationId),
              eq(aiExecutionPermits.executionAttempt, aiOperationAttempts.attempt),
            ),
          )
          .where(
            and(
              eq(aiOperationAttempts.operationId, row.id),
              eq(aiOperationAttempts.attempt, row.executionAttempt),
            ),
          )
          .limit(1)
        executionPermitId = attempt?.executionPermitId ?? null
      }
      return mapOperation(row, executionPermitId)
    },

    async claimExecution(input) {
      return db.transaction(async (tx) => {
        const now = new Date(input.nowEpochMillis)
        const [claimed] = await tx
          .update(aiOperations)
          .set({
            state: 'executing',
            executionAttempt: input.expectedAttempt,
            nextAttemptAt: null,
            failureCode: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(aiOperations.id, input.operationId),
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
        await tx.insert(aiOperationAttempts).values({
          operationId: claimed.id,
          attempt: input.expectedAttempt,
          state: 'executing',
          modelSnapshot: null,
          inputTokens: null,
          outputTokens: null,
          failureCode: null,
          startedAt: now,
          settledAt: null,
        })
        const permitId = randomUUID()
        const stopFence = parseBinding(claimed).stopFence
        await tx.insert(aiExecutionPermits).values({
          id: permitId,
          operationId: claimed.id,
          executionAttempt: input.expectedAttempt,
          globalControlId: stopFence.globalControlId,
          globalControlGeneration: stopFence.globalGeneration,
          providerControlId: stopFence.providerControlId,
          providerControlGeneration: stopFence.providerGeneration,
          capabilityControlId:
            'capabilityControlId' in stopFence ? stopFence.capabilityControlId : null,
          capabilityControlGeneration:
            'capabilityGeneration' in stopFence ? stopFence.capabilityGeneration : null,
          route:
            claimed.command === 'analysis'
              ? 'review-analysis'
              : claimed.command === 'reply'
                ? 'reply-suggestion'
                : claimed.command === 'trend'
                  ? 'property-trend'
                  : 'synthetic-canary',
          state: 'issued',
          admittedAt: now,
          expiresAt: claimed.expiresAt,
        })
        return mapOperation(claimed, permitId)
      })
    },

    async recordFailure(input) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({ id: aiOperations.id })
          .from(aiOperations)
          .where(
            and(
              eq(aiOperations.id, input.operationId),
              eq(aiOperations.state, 'executing'),
              eq(aiOperations.executionAttempt, input.expectedAttempt),
            ),
          )
          .limit(1)
          .for('update')
        if (!operation) return false
        const failedAt = new Date(input.failedAtEpochMillis)
        const settledAttempts = await tx
          .update(aiOperationAttempts)
          .set({
            state: 'failed',
            failureCode: input.failureCode,
            settledAt: failedAt,
          })
          .where(
            and(
              eq(aiOperationAttempts.operationId, input.operationId),
              eq(aiOperationAttempts.attempt, input.expectedAttempt),
              eq(aiOperationAttempts.state, 'executing'),
            ),
          )
          .returning({ attempt: aiOperationAttempts.attempt })
        if (settledAttempts.length !== 1) {
          failCorrupt('executing AI operation attempt is missing')
        }
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
          .where(eq(aiOperations.id, input.operationId))
        return true
      })
    },

    async listExpiredExecutions(input) {
      // Lock-free and allowed to be stale: every row this returns is re-checked
      // by `recordFailure`, whose CAS matches on `state = 'executing'` AND the
      // exact attempt. A row that settled between this scan and the write loses
      // the CAS and is counted, never overwritten.
      //
      // The predicate is the OPEN ATTEMPT's age, not the operation's
      // `expires_at`. `expires_at` is the idempotency lifetime — 24 hours for a
      // review analysis — while an attempt is bounded by the domain's 15-minute
      // operation horizon, so an `expires_at`-only scan cannot see an
      // abandonment for a whole day. It did not: four closed-beta operations sat
      // `executing` with settled `success` permits while this reported
      // `abandonedVisited=0` on every run. `expires_at` remains a second,
      // independent trigger for anything with no open attempt row to age.
      const now = new Date(input.nowEpochMillis)
      const attemptDeadline = new Date(
        input.nowEpochMillis - input.executionHorizonMillis,
      )
      const rows = await db
        .select({
          operationId: aiOperations.id,
          attempt: aiOperations.executionAttempt,
        })
        .from(aiOperations)
        .leftJoin(
          aiOperationAttempts,
          and(
            eq(aiOperationAttempts.operationId, aiOperations.id),
            eq(aiOperationAttempts.attempt, aiOperations.executionAttempt),
            eq(aiOperationAttempts.state, 'executing'),
          ),
        )
        .where(
          and(
            eq(aiOperations.state, 'executing'),
            or(
              lte(aiOperations.expiresAt, now),
              lte(aiOperationAttempts.startedAt, attemptDeadline),
            ),
          ),
        )
        .orderBy(aiOperations.expiresAt)
        .limit(input.limit)
      return rows.map((row) => ({
        operationId: row.operationId as AiOperationId,
        attempt: row.attempt,
      }))
    },

    async markDelivered(input) {
      const deliveredAt = new Date(input.deliveredAtEpochMillis)
      const rows = await db
        .update(aiOperations)
        .set({ state: 'succeeded', deliveredAt, updatedAt: deliveredAt })
        .where(
          and(
            eq(aiOperations.id, input.operationId),
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
