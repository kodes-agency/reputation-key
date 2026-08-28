import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import {
  gbpImportItemRetryReceipts,
  gbpImportRequestItems,
  gbpImportRequests,
  gbpImportSagas,
} from '#/shared/db/schema/google-import-v2.schema'
import { organizationId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
  PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
  getImportOutcomePresentation,
  type GbpImportItemStatus,
  type ImportProgressDto,
  type ImportProgressItemDto,
} from '../application/google-import-v2-contract'
import {
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2ClaimedItem,
  type GoogleImportV2Intent,
  type GoogleImportV2LifecycleScope,
  type GoogleImportV2Store,
} from '../application/ports/google-import-v2-store.port'
import { reduceGoogleImportParent } from '../application/google-import-v2-reducer'
import {
  GOOGLE_IMPORT_BATCH_SIZE,
  reduceGoogleImportSaga,
} from '../application/google-import-saga'
import type {
  IntegrationPropertyImportRequested,
  IntegrationPropertyImportRetentionReleased,
} from '../domain/events'

const ACTIVE_STATUSES = new Set(['queued', 'processing'])

/**
 * Progress polling backs off on parent *staleness*, not elapsed total. Every
 * committed item advance refreshes `updatedAt` and returns the client to the fast
 * interval, while a parent that stops moving decays to the cap instead of costing
 * two queries plus an authorization round-trip per retry candidate every second
 * for as long as the tab stays open.
 */
const PROGRESS_POLL_FAST_MS = 1_000
const PROGRESS_POLL_MEDIUM_MS = 5_000
/** Cap. No active parent is ever polled less often than this. */
const PROGRESS_POLL_SLOW_MS = 15_000
const PROGRESS_POLL_FAST_UNTIL_STALE_MS = 30_000
const PROGRESS_POLL_MEDIUM_UNTIL_STALE_MS = 120_000

/**
 * Pure poll-interval hint. `null` means "stop polling": the parent is terminal.
 * The client honours this value verbatim, so all backoff policy lives here.
 */
export function googleImportProgressPollAfterMs(
  status: string,
  updatedAtMs: number,
  nowMs: number,
): number | null {
  if (!ACTIVE_STATUSES.has(status)) return null
  const staleMs = nowMs - updatedAtMs
  // A future or unusable `updatedAt` must not buy a slower interval than a fresh
  // one, so anything below the first threshold — including negatives — is fast.
  if (!Number.isFinite(staleMs) || staleMs < PROGRESS_POLL_FAST_UNTIL_STALE_MS) {
    return PROGRESS_POLL_FAST_MS
  }
  if (staleMs < PROGRESS_POLL_MEDIUM_UNTIL_STALE_MS) return PROGRESS_POLL_MEDIUM_MS
  return PROGRESS_POLL_SLOW_MS
}

function pgErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error) return error.code
  if (!('cause' in error)) return undefined
  const cause = error.cause
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return undefined
  }
  return cause.code
}

function isPgUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505'
}

function assertLifecycleSweepLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('google import lifecycle sweep limit must be between 1 and 100')
  }
}

function requestedEvent(
  input: Readonly<{
    eventId: string
    organizationId: string
    importJobId: string
    now: Date
  }>,
): IntegrationPropertyImportRequested {
  return {
    _tag: 'integration.property_import.requested',
    eventId: input.eventId,
    organizationId: organizationId(input.organizationId),
    importJobId: input.importJobId,
    occurredAt: input.now,
    correlationId: null,
  }
}

function retentionReleasedEvent(
  input: Readonly<{
    eventId: string
    organizationId: string
    importJobId: string
    itemIds: readonly string[]
    now: Date
  }>,
): IntegrationPropertyImportRetentionReleased {
  return {
    _tag: PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
    eventId: input.eventId,
    organizationId: organizationId(input.organizationId),
    importJobId: input.importJobId,
    idempotencyKeys: input.itemIds,
    occurredAt: input.now,
    correlationId: null,
  }
}

function authorizationColumns(item: GoogleImportV2Intent['items'][number]) {
  const vector = item.authorization.authorizationVector
  return {
    approvalBindingId: item.authorization.approvalBindingId,
    expectedExecutionPolicyVersion: String(vector.executionPolicyVersion),
    expectedGoogleContentPolicyVersion: Number(vector.googleContentPolicyVersion),
    expectedEmergencyKillVersion: Number(vector.emergencyKillVersion),
    expectedActorRole: String(vector.role),
    expectedPermissionDigest: String(vector.permissionDigest),
  }
}

function authorizationFromRow(row: {
  organizationId: string
  initiatedBy: string
  connectionId: string | null
  expectedConnectionLifecycleVersion: number | null
  expectedConnectionAccessVersion: number | null
  expectedCredentialGeneration: number | null
  approvalBindingId: string | null
  expectedExecutionPolicyVersion: string | null
  expectedGoogleContentPolicyVersion: number | null
  expectedEmergencyKillVersion: number | null
  expectedActorRole: string | null
  expectedPermissionDigest: string | null
}) {
  if (
    row.connectionId === null ||
    row.expectedConnectionLifecycleVersion === null ||
    row.expectedConnectionAccessVersion === null ||
    row.expectedCredentialGeneration === null ||
    row.approvalBindingId === null ||
    row.expectedExecutionPolicyVersion === null ||
    row.expectedGoogleContentPolicyVersion === null ||
    row.expectedEmergencyKillVersion === null ||
    row.expectedActorRole === null ||
    row.expectedPermissionDigest === null
  ) {
    return null
  }
  return {
    organizationId: row.organizationId,
    userId: row.initiatedBy,
    connectionId: row.connectionId,
    connectionLifecycleVersion: row.expectedConnectionLifecycleVersion,
    connectionAccessVersion: row.expectedConnectionAccessVersion,
    credentialGeneration: row.expectedCredentialGeneration,
    approvalBindingId: row.approvalBindingId,
    authorizationVector: {
      executionPolicyVersion: row.expectedExecutionPolicyVersion,
      googleContentPolicyVersion: row.expectedGoogleContentPolicyVersion,
      emergencyKillVersion: row.expectedEmergencyKillVersion,
      role: row.expectedActorRole,
      permissionDigest: row.expectedPermissionDigest,
      connectionLifecycleVersion: row.expectedConnectionLifecycleVersion,
      connectionAccessVersion: row.expectedConnectionAccessVersion,
      credentialGeneration: row.expectedCredentialGeneration,
    },
  } as const
}

function parentPatch(reduction: ReturnType<typeof reduceGoogleImportParent>) {
  return {
    status: reduction.status,
    processedCount: reduction.processedCount,
    pendingCount: reduction.counts.pending,
    processingCount: reduction.counts.processing,
    importedCount: reduction.counts.imported,
    relinkedCount: reduction.counts.relinked,
    alreadyExistsCount: reduction.counts.already_exists,
    regionUnavailableCount: reduction.counts.region_unavailable,
    failedCount: reduction.counts.failed,
    cancelledCount: reduction.counts.cancelled,
    firstTerminalAt: reduction.firstTerminalAt,
    purgeAt: reduction.purgeAt,
  }
}

function lifecycleScopePredicate(scope: GoogleImportV2LifecycleScope) {
  const tenant = eq(gbpImportRequestItems.organizationId, scope.organizationId)
  switch (scope.kind) {
    case 'organization':
      return tenant
    case 'user':
      return and(tenant, eq(gbpImportRequests.initiatedBy, scope.userId))
    case 'connection':
      return and(tenant, eq(gbpImportRequestItems.connectionId, scope.connectionId))
    case 'property':
      return and(
        tenant,
        or(
          eq(gbpImportRequestItems.existingPropertyId, scope.propertyId),
          eq(gbpImportRequestItems.destinationPropertyId, scope.propertyId),
        ),
      )
    case 'request':
      return and(
        tenant,
        or(
          eq(gbpImportRequests.id, scope.importJobId),
          eq(gbpImportRequests.sagaId, scope.importJobId),
        ),
      )
  }
}

const lifecycleAuthorityPresent = or(
  sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
  eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
  isNotNull(gbpImportRequestItems.connectionId),
  isNotNull(gbpImportRequestItems.existingPropertyId),
  isNotNull(gbpImportRequestItems.destinationPropertyId),
  isNotNull(gbpImportRequestItems.providerAccountSuffix),
  isNotNull(gbpImportRequestItems.providerLocationSuffix),
  isNotNull(gbpImportRequestItems.expectedConnectionLifecycleVersion),
  isNotNull(gbpImportRequestItems.expectedConnectionAccessVersion),
  isNotNull(gbpImportRequestItems.expectedCredentialGeneration),
  isNotNull(gbpImportRequestItems.approvalBindingId),
  isNotNull(gbpImportRequestItems.expectedSourceEpoch),
  isNotNull(gbpImportRequestItems.expectedProfileVersion),
)

type GoogleImportItemRow = typeof gbpImportRequestItems.$inferSelect

function progressItemFromRow(row: GoogleImportItemRow): ImportProgressItemDto {
  const presentation = row.outcomeCode
    ? getImportOutcomePresentation(row.outcomeCode)
    : null
  const retryable =
    (presentation?.retryable ?? false) &&
    row.connectionId !== null &&
    row.providerAccountSuffix !== null &&
    row.providerLocationSuffix !== null
  return {
    itemId: row.id,
    propertyName: row.propertyName,
    action: row.action,
    status: row.status as GbpImportItemStatus,
    outcomeCode: row.outcomeCode,
    messageKey: `property_import.${row.outcomeCode ?? row.status}`,
    retryable,
    retryRevision: row.retryRevision,
    userAction: retryable ? (presentation?.userAction ?? 'none') : 'none',
  }
}

async function loadSagaProgress(
  db: Database,
  saga: typeof gbpImportSagas.$inferSelect,
  clock: Clock,
): Promise<ImportProgressDto> {
  const batches = await db
    .select()
    .from(gbpImportRequests)
    .where(
      and(
        eq(gbpImportRequests.organizationId, saga.organizationId),
        eq(gbpImportRequests.sagaId, saga.id),
      ),
    )
    .orderBy(asc(gbpImportRequests.batchOrdinal), asc(gbpImportRequests.id))
  if (
    batches.length !== saga.batchCount ||
    batches.some((batch, index) => batch.batchOrdinal !== index)
  ) {
    throw new Error('Google import saga child-batch checkpoint is incomplete')
  }
  const reduction = reduceGoogleImportSaga(
    batches.map((batch) => ({
      status: batch.status,
      totalCount: batch.totalCount,
      processedCount: batch.processedCount,
      counts: {
        pending: batch.pendingCount,
        processing: batch.processingCount,
        imported: batch.importedCount,
        relinked: batch.relinkedCount,
        already_exists: batch.alreadyExistsCount,
        region_unavailable: batch.regionUnavailableCount,
        failed: batch.failedCount,
        cancelled: batch.cancelledCount,
      },
    })),
  )
  if (reduction.totalCount !== saga.totalCount) {
    throw new Error('Google import saga total does not match its child batches')
  }
  const rows = await db
    .select({ item: gbpImportRequestItems })
    .from(gbpImportRequestItems)
    .innerJoin(
      gbpImportRequests,
      and(
        eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
        eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
      ),
    )
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, saga.organizationId),
        eq(gbpImportRequests.sagaId, saga.id),
      ),
    )
    .orderBy(
      asc(gbpImportRequests.batchOrdinal),
      asc(gbpImportRequestItems.createdAt),
      asc(gbpImportRequestItems.id),
    )
  if (rows.length !== saga.totalCount) {
    throw new Error('Google import saga item checkpoint is incomplete')
  }
  const items = rows.map(({ item }) => progressItemFromRow(item))
  const updatedAt = batches.reduce(
    (latest, batch) =>
      batch.updatedAt.getTime() > latest.getTime() ? batch.updatedAt : latest,
    saga.updatedAt,
  )
  const purgeAt = batches.every((batch) => batch.purgeAt !== null)
    ? new Date(Math.max(...batches.map((batch) => batch.purgeAt!.getTime())))
    : null
  return {
    contractVersion: GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
    importJobId: saga.id,
    requestId: saga.requestId,
    status: reduction.status,
    totalCount: reduction.totalCount,
    processedCount: reduction.processedCount,
    counts: reduction.counts,
    items,
    canRetry: items.some((item) => item.retryable),
    pollAfterMs: googleImportProgressPollAfterMs(
      reduction.status,
      updatedAt.getTime(),
      clock().getTime(),
    ),
    purgeAt: purgeAt?.toISOString() ?? null,
    updatedAt: updatedAt.toISOString(),
  }
}

async function loadProgress(
  db: Database,
  organizationId: string,
  importJobId: string,
  clock: Clock,
  initiatedBy?: string,
): Promise<ImportProgressDto | null> {
  const [saga] = await db
    .select()
    .from(gbpImportSagas)
    .where(
      and(
        eq(gbpImportSagas.organizationId, organizationId),
        eq(gbpImportSagas.id, importJobId),
      ),
    )
    .limit(1)
  if (saga) {
    if (initiatedBy !== undefined && saga.initiatedBy !== initiatedBy) return null
    return loadSagaProgress(db, saga, clock)
  }
  const [parent] = await db
    .select()
    .from(gbpImportRequests)
    .where(
      and(
        eq(gbpImportRequests.organizationId, organizationId),
        initiatedBy === undefined
          ? undefined
          : eq(gbpImportRequests.initiatedBy, initiatedBy),
        eq(gbpImportRequests.id, importJobId),
      ),
    )
    .limit(1)
  if (!parent) return null
  const rows = await db
    .select()
    .from(gbpImportRequestItems)
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, organizationId),
        eq(gbpImportRequestItems.importJobId, importJobId),
      ),
    )
    .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
  const items = rows.map(progressItemFromRow)
  const counts = {
    pending: parent.pendingCount,
    processing: parent.processingCount,
    imported: parent.importedCount,
    relinked: parent.relinkedCount,
    already_exists: parent.alreadyExistsCount,
    region_unavailable: parent.regionUnavailableCount,
    failed: parent.failedCount,
    cancelled: parent.cancelledCount,
  } satisfies Record<GbpImportItemStatus, number>
  return {
    contractVersion: GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
    importJobId: parent.id,
    requestId: parent.requestId,
    status: parent.status,
    totalCount: parent.totalCount,
    processedCount: parent.processedCount,
    counts,
    items,
    canRetry: items.some((item) => item.retryable),
    pollAfterMs: googleImportProgressPollAfterMs(
      parent.status,
      parent.updatedAt.getTime(),
      clock().getTime(),
    ),
    purgeAt: parent.purgeAt?.toISOString() ?? null,
    updatedAt: parent.updatedAt.toISOString(),
  }
}

export const createGoogleImportV2Store = (
  db: Database,
  clock: Clock,
): GoogleImportV2Store => {
  return Object.freeze({
    findReplay: async (organizationId, requestId) => {
      const [saga] = await db
        .select({
          importJobId: gbpImportSagas.id,
          initiatedBy: gbpImportSagas.initiatedBy,
          wireReplayKeyVersion: gbpImportSagas.wireReplayKeyVersion,
          wireReplayDigest: gbpImportSagas.wireReplayDigest,
          semanticReplayKeyVersion: gbpImportSagas.semanticReplayKeyVersion,
          semanticReplayDigest: gbpImportSagas.semanticReplayDigest,
        })
        .from(gbpImportSagas)
        .where(
          and(
            eq(gbpImportSagas.organizationId, organizationId),
            eq(gbpImportSagas.requestId, requestId),
          ),
        )
        .limit(1)
      if (saga) {
        return {
          importJobId: saga.importJobId,
          initiatedBy: saga.initiatedBy,
          wireReplay: {
            keyVersion: saga.wireReplayKeyVersion,
            digest: saga.wireReplayDigest,
          },
          semanticReplay: {
            keyVersion: saga.semanticReplayKeyVersion,
            digest: saga.semanticReplayDigest,
          },
        }
      }
      const [row] = await db
        .select({
          importJobId: gbpImportRequests.id,
          initiatedBy: gbpImportRequests.initiatedBy,
          wireReplayKeyVersion: gbpImportRequests.wireReplayKeyVersion,
          wireReplayDigest: gbpImportRequests.wireReplayDigest,
          semanticReplayKeyVersion: gbpImportRequests.semanticReplayKeyVersion,
          semanticReplayDigest: gbpImportRequests.semanticReplayDigest,
        })
        .from(gbpImportRequests)
        .where(
          and(
            eq(gbpImportRequests.organizationId, organizationId),
            eq(gbpImportRequests.requestId, requestId),
          ),
        )
        .limit(1)
      if (!row) return null
      return {
        importJobId: row.importJobId,
        initiatedBy: row.initiatedBy,
        wireReplay:
          row.wireReplayKeyVersion && row.wireReplayDigest
            ? {
                keyVersion: row.wireReplayKeyVersion,
                digest: row.wireReplayDigest,
              }
            : null,
        semanticReplay:
          row.semanticReplayKeyVersion && row.semanticReplayDigest
            ? {
                keyVersion: row.semanticReplayKeyVersion,
                digest: row.semanticReplayDigest,
              }
            : null,
      }
    },

    commitSaga: async (intent) => {
      const batches = [...intent.batches].sort(
        (left, right) => left.ordinal - right.ordinal,
      )
      if (
        batches.length === 0 ||
        batches.some(
          (batch, index) =>
            batch.ordinal !== index ||
            batch.items.length < 1 ||
            batch.items.length > GOOGLE_IMPORT_BATCH_SIZE ||
            (index < batches.length - 1 &&
              batch.items.length !== GOOGLE_IMPORT_BATCH_SIZE),
        ) ||
        new Set(batches.flatMap((batch) => batch.items.map((item) => item.id))).size !==
          batches.reduce((total, batch) => total + batch.items.length, 0)
      ) {
        throw new Error('invalid Google import saga batch plan')
      }
      const totalCount = batches.reduce((total, batch) => total + batch.items.length, 0)
      try {
        await db.transaction(async (tx) => {
          await tx.insert(gbpImportSagas).values({
            id: intent.id,
            organizationId: intent.organizationId,
            requestId: intent.requestId,
            initiatedBy: intent.initiatedBy,
            totalCount,
            batchCount: batches.length,
            wireReplayKeyVersion: intent.wireReplay.keyVersion,
            wireReplayDigest: intent.wireReplay.digest,
            semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
            semanticReplayDigest: intent.semanticReplay.digest,
            createdAt: intent.now,
            updatedAt: intent.now,
          })

          for (const batch of batches) {
            await tx.insert(gbpImportRequests).values({
              id: batch.id,
              organizationId: intent.organizationId,
              requestId: batch.requestId,
              initiatedBy: intent.initiatedBy,
              sagaId: intent.id,
              batchOrdinal: batch.ordinal,
              totalCount: batch.items.length,
              pendingCount: batch.items.length,
              // Keep the established lifecycle fencing path authoritative for
              // every child while replay recovery resolves through the saga.
              wireReplayKeyVersion: intent.wireReplay.keyVersion,
              wireReplayDigest: intent.wireReplay.digest,
              semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
              semanticReplayDigest: intent.semanticReplay.digest,
              createdAt: intent.now,
              updatedAt: intent.now,
            })
            await tx.insert(gbpImportRequestItems).values(
              batch.items.map((item) => {
                const { authorization: _authorization, ...persisted } = item
                return {
                  ...persisted,
                  ...authorizationColumns(item),
                  organizationId: intent.organizationId,
                  importJobId: batch.id,
                  createdAt: intent.now,
                  updatedAt: intent.now,
                }
              }),
            )
            await insertOutboxRow(
              tx,
              requestedEvent({
                eventId: batch.outboxEventId,
                organizationId: intent.organizationId,
                importJobId: batch.id,
                now: intent.now,
              }),
              { recordedAt: intent.now },
            )
          }
        })
        return 'committed' as const
      } catch (error) {
        if (isPgUniqueViolation(error)) return 'conflict' as const
        throw error
      }
    },

    commitIntent: async (intent) => {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(gbpImportRequests).values({
            id: intent.id,
            organizationId: intent.organizationId,
            requestId: intent.requestId,
            initiatedBy: intent.initiatedBy,
            totalCount: intent.items.length,
            pendingCount: intent.items.length,
            wireReplayKeyVersion: intent.wireReplay.keyVersion,
            wireReplayDigest: intent.wireReplay.digest,
            semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
            semanticReplayDigest: intent.semanticReplay.digest,
            createdAt: intent.now,
            updatedAt: intent.now,
          })
          await tx.insert(gbpImportRequestItems).values(
            intent.items.map((item) => {
              const { authorization: _authorization, ...persisted } = item
              return {
                ...persisted,
                ...authorizationColumns(item),
                organizationId: intent.organizationId,
                importJobId: intent.id,
                createdAt: intent.now,
                updatedAt: intent.now,
              }
            }),
          )
          await insertOutboxRow(
            tx,
            requestedEvent({
              eventId: intent.outboxEventId,
              organizationId: intent.organizationId,
              importJobId: intent.id,
              now: intent.now,
            }),
            { recordedAt: intent.now },
          )
        })
        return 'committed' as const
      } catch (error) {
        if (isPgUniqueViolation(error)) return 'conflict' as const
        throw error
      }
    },

    retryItem: async (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            organizationId: gbpImportRequestItems.organizationId,
            importJobId: gbpImportRequestItems.importJobId,
            sagaId: gbpImportRequests.sagaId,
            itemId: gbpImportRequestItems.id,
            initiatedBy: gbpImportRequests.initiatedBy,
            parentPurgeAt: gbpImportRequests.purgeAt,
            parentFirstTerminalAt: gbpImportRequests.firstTerminalAt,
            connectionId: gbpImportRequestItems.connectionId,
            existingPropertyId: gbpImportRequestItems.existingPropertyId,
            expectedConnectionLifecycleVersion:
              gbpImportRequestItems.expectedConnectionLifecycleVersion,
            expectedConnectionAccessVersion:
              gbpImportRequestItems.expectedConnectionAccessVersion,
            expectedCredentialGeneration:
              gbpImportRequestItems.expectedCredentialGeneration,
            approvalBindingId: gbpImportRequestItems.approvalBindingId,
            expectedExecutionPolicyVersion:
              gbpImportRequestItems.expectedExecutionPolicyVersion,
            expectedGoogleContentPolicyVersion:
              gbpImportRequestItems.expectedGoogleContentPolicyVersion,
            expectedEmergencyKillVersion:
              gbpImportRequestItems.expectedEmergencyKillVersion,
            expectedActorRole: gbpImportRequestItems.expectedActorRole,
            expectedPermissionDigest: gbpImportRequestItems.expectedPermissionDigest,
            expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
            expectedProfileVersion: gbpImportRequestItems.expectedProfileVersion,
            providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
            providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
            googleReviewUri: gbpImportRequestItems.googleReviewUri,
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            retryRevision: gbpImportRequestItems.retryRevision,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
            ),
          )
          .for('update')
          .limit(1)
        if (!row) return { kind: 'rejected', reason: 'missing' } as const
        const progressId = row.sagaId ?? row.importJobId
        if (row.initiatedBy !== input.initiatingUserId) {
          return { kind: 'rejected', reason: 'not_initiator' } as const
        }
        if (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt) {
          return { kind: 'rejected', reason: 'effect_expired' } as const
        }

        const [receipt] = await tx
          .select({
            requestDigestKeyVersion: gbpImportItemRetryReceipts.requestDigestKeyVersion,
            requestDigest: gbpImportItemRetryReceipts.requestDigest,
            acceptedRetryRevision: gbpImportItemRetryReceipts.acceptedRetryRevision,
          })
          .from(gbpImportItemRetryReceipts)
          .where(
            and(
              eq(gbpImportItemRetryReceipts.organizationId, input.organizationId),
              eq(gbpImportItemRetryReceipts.initiatingUserId, input.initiatingUserId),
              eq(gbpImportItemRetryReceipts.itemId, input.itemId),
              eq(gbpImportItemRetryReceipts.retryRequestId, input.retryRequestId),
            ),
          )
          .limit(1)
        if (receipt) {
          if (
            !input.matchesRequestDigest({
              keyVersion: receipt.requestDigestKeyVersion,
              digest: receipt.requestDigest,
            })
          ) {
            return { kind: 'rejected', reason: 'request_conflict' } as const
          }
          return {
            kind: 'replayed',
            importJobId: progressId,
            retryRevision: receipt.acceptedRetryRevision,
          } as const
        }

        if (row.retryRevision !== input.expectedRetryRevision) {
          return { kind: 'rejected', reason: 'stale_revision' } as const
        }
        if (
          row.status !== 'failed' ||
          row.outcomeCode !== 'temporarily_unavailable' ||
          row.connectionId === null ||
          row.providerAccountSuffix === null ||
          row.providerLocationSuffix === null
        ) {
          return { kind: 'rejected', reason: 'not_retryable' } as const
        }
        if (input.now >= row.effectDeadlineAt) {
          return { kind: 'rejected', reason: 'effect_expired' } as const
        }
        const authorization = authorizationFromRow(row)
        if (!authorization) {
          return { kind: 'rejected', reason: 'not_retryable' } as const
        }
        const authorizationDecision = await input.authorize({
          importJobId: progressId,
          itemId: row.itemId,
          connectionId: row.connectionId,
          existingPropertyId: row.existingPropertyId,
          expectedSourceEpoch: row.expectedSourceEpoch,
          expectedProfileVersion: row.expectedProfileVersion,
          authorization,
        })
        if (authorizationDecision !== 'authorized') {
          return {
            kind: 'rejected',
            reason:
              authorizationDecision === 'unavailable'
                ? 'authorization_unavailable'
                : 'authorization_denied',
          } as const
        }

        const retryRevision = row.retryRevision + 1
        await tx.insert(gbpImportItemRetryReceipts).values({
          organizationId: input.organizationId,
          initiatingUserId: input.initiatingUserId,
          itemId: input.itemId,
          retryRequestId: input.retryRequestId,
          requestDigestKeyVersion: input.requestDigest.keyVersion,
          requestDigest: input.requestDigest.digest,
          acceptedRetryRevision: retryRevision,
          createdAt: input.now,
        })
        const [updated] = await tx
          .update(gbpImportRequestItems)
          .set({
            status: 'pending',
            outcomeCode: null,
            retryRevision,
            highestAttemptForRevision: 0,
            claimFence: null,
            claimLeaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.expectedRetryRevision),
              eq(gbpImportRequestItems.status, 'failed'),
              eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
            ),
          )
          .returning({ id: gbpImportRequestItems.id })
        if (!updated) {
          throw new Error('google import retry CAS failed while item lock was held')
        }

        const rows = await tx
          .select({
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, row.importJobId),
            ),
          )
        const reduction = reduceGoogleImportParent({
          items: rows,
          firstTerminalAt: row.parentFirstTerminalAt,
          now: input.now,
        })
        await tx
          .update(gbpImportRequests)
          .set({ ...parentPatch(reduction), updatedAt: input.now })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, row.importJobId),
            ),
          )
        await insertOutboxRow(
          tx,
          requestedEvent({
            eventId: input.outboxEventId,
            organizationId: input.organizationId,
            importJobId: row.importJobId,
            now: input.now,
          }),
          { recordedAt: input.now },
        )
        return {
          kind: 'accepted',
          importJobId: progressId,
          retryRevision,
        } as const
      }),

    claimItem: async (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            organizationId: gbpImportRequestItems.organizationId,
            importJobId: gbpImportRequestItems.importJobId,
            itemId: gbpImportRequestItems.id,
            initiatedBy: gbpImportRequests.initiatedBy,
            connectionId: gbpImportRequestItems.connectionId,
            existingPropertyId: gbpImportRequestItems.existingPropertyId,
            destinationPropertyId: gbpImportRequestItems.destinationPropertyId,
            providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
            providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
            googleReviewUri: gbpImportRequestItems.googleReviewUri,
            expectedConnectionLifecycleVersion:
              gbpImportRequestItems.expectedConnectionLifecycleVersion,
            expectedConnectionAccessVersion:
              gbpImportRequestItems.expectedConnectionAccessVersion,
            expectedCredentialGeneration:
              gbpImportRequestItems.expectedCredentialGeneration,
            approvalBindingId: gbpImportRequestItems.approvalBindingId,
            expectedExecutionPolicyVersion:
              gbpImportRequestItems.expectedExecutionPolicyVersion,
            expectedGoogleContentPolicyVersion:
              gbpImportRequestItems.expectedGoogleContentPolicyVersion,
            expectedEmergencyKillVersion:
              gbpImportRequestItems.expectedEmergencyKillVersion,
            expectedActorRole: gbpImportRequestItems.expectedActorRole,
            expectedPermissionDigest: gbpImportRequestItems.expectedPermissionDigest,
            expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
            expectedProfileVersion: gbpImportRequestItems.expectedProfileVersion,
            action: gbpImportRequestItems.action,
            updateExistingProfile: gbpImportRequestItems.updateExistingProfile,
            propertyName: gbpImportRequestItems.propertyName,
            propertyAddress: gbpImportRequestItems.propertyAddress,
            countryCode: gbpImportRequestItems.countryCode,
            timezone: gbpImportRequestItems.timezone,
            processingRegion: gbpImportRequestItems.processingRegion,
            routingPolicyVersion: gbpImportRequestItems.routingPolicyVersion,
            status: gbpImportRequestItems.status,
            retryRevision: gbpImportRequestItems.retryRevision,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
            claimLeaseExpiresAt: gbpImportRequestItems.claimLeaseExpiresAt,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
            parentPurgeAt: gbpImportRequests.purgeAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
            ),
          )
          .for('update', { of: gbpImportRequestItems })
          .limit(1)
        if (!row) return { kind: 'ignored', reason: 'missing' } as const
        if (row.status !== 'pending' && row.status !== 'processing') {
          return { kind: 'ignored', reason: 'terminal' } as const
        }
        if (row.retryRevision !== input.retryRevision) {
          return { kind: 'ignored', reason: 'stale_revision' } as const
        }
        const expiredClaim =
          row.status === 'processing' &&
          row.claimLeaseExpiresAt !== null &&
          row.claimLeaseExpiresAt <= input.now
        if (row.status === 'processing' && !expiredClaim) {
          return { kind: 'ignored', reason: 'claim_active' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return { kind: 'ignored', reason: 'effect_expired' } as const
        }
        const nextAttempt = row.highestAttemptForRevision + 1
        const validAttempt =
          row.status === 'pending'
            ? input.attemptOrdinal === nextAttempt
            : input.attemptOrdinal === row.highestAttemptForRevision ||
              input.attemptOrdinal === nextAttempt
        if (!validAttempt || input.attemptOrdinal > GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS) {
          return { kind: 'ignored', reason: 'stale_attempt' } as const
        }
        const authorization = authorizationFromRow(row)
        if (
          !authorization ||
          row.destinationPropertyId === null ||
          row.providerAccountSuffix === null ||
          row.providerLocationSuffix === null ||
          row.connectionId === null
        ) {
          throw new Error('google import item authorization snapshot is incomplete')
        }
        const [claimed] = await tx
          .update(gbpImportRequestItems)
          .set({
            status: 'processing',
            highestAttemptForRevision: input.attemptOrdinal,
            claimFence: input.claimFence,
            claimLeaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
            ),
          )
          .returning({ id: gbpImportRequestItems.id })
        if (!claimed) return { kind: 'ignored', reason: 'claim_active' } as const
        if (row.status === 'pending') {
          await tx
            .update(gbpImportRequests)
            .set({
              status: 'processing',
              pendingCount: sql`${gbpImportRequests.pendingCount} - 1`,
              processingCount: sql`${gbpImportRequests.processingCount} + 1`,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(gbpImportRequests.organizationId, row.organizationId),
                eq(gbpImportRequests.id, row.importJobId),
              ),
            )
        }
        return {
          kind: 'claimed',
          item: {
            ...row,
            connectionId: row.connectionId,
            expectedConnectionLifecycleVersion: authorization.connectionLifecycleVersion,
            expectedConnectionAccessVersion: authorization.connectionAccessVersion,
            expectedCredentialGeneration: authorization.credentialGeneration,
            destinationPropertyId: row.destinationPropertyId,
            providerAccountSuffix: row.providerAccountSuffix,
            providerLocationSuffix: row.providerLocationSuffix,
            googleReviewUri: row.googleReviewUri,
            authorization,
            attemptOrdinal: input.attemptOrdinal,
            claimFence: input.claimFence,
          } satisfies GoogleImportV2ClaimedItem,
        } as const
      }),

    runClaimedEffect: async (input, effect) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            status: gbpImportRequestItems.status,
            retryRevision: gbpImportRequestItems.retryRevision,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
            claimFence: gbpImportRequestItems.claimFence,
            claimLeaseExpiresAt: gbpImportRequestItems.claimLeaseExpiresAt,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
            parentPurgeAt: gbpImportRequests.purgeAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
            ),
          )
          .for('update', { of: gbpImportRequestItems })
          .limit(1)
        if (
          !row ||
          row.status !== 'processing' ||
          row.retryRevision !== input.retryRevision ||
          row.highestAttemptForRevision !== input.attemptOrdinal ||
          row.claimFence !== input.claimFence ||
          row.claimLeaseExpiresAt === null ||
          row.claimLeaseExpiresAt <= input.now
        ) {
          return { kind: 'lost' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return { kind: 'effect_expired' } as const
        }
        return { kind: 'executed', value: await effect() } as const
      }),

    releaseClaimForRetry: async (input) =>
      db.transaction(async (tx) => {
        const [released] = await tx
          .update(gbpImportRequestItems)
          .set({
            status: 'pending',
            claimFence: null,
            claimLeaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              eq(gbpImportRequestItems.claimFence, input.claimFence),
              eq(gbpImportRequestItems.status, 'processing'),
            ),
          )
          .returning({ importJobId: gbpImportRequestItems.importJobId })
        if (!released) return 'lost' as const
        await tx
          .update(gbpImportRequests)
          .set({
            pendingCount: sql`${gbpImportRequests.pendingCount} + 1`,
            processingCount: sql`${gbpImportRequests.processingCount} - 1`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, released.importJobId),
            ),
          )
        return 'released' as const
      }),

    reconcileFromReceipt: async (input) =>
      db.transaction(async (tx) => {
        const [item] = await tx
          .select({
            importJobId: gbpImportRequestItems.importJobId,
            action: gbpImportRequestItems.action,
            destinationPropertyId: gbpImportRequestItems.destinationPropertyId,
            firstTerminalAt: gbpImportRequestItems.firstTerminalAt,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
            ),
          )
          .for('update')
          .limit(1)
        if (!item) return 'lost' as const
        if (
          (input.destinationPropertyId !== null &&
            input.destinationPropertyId !== item.destinationPropertyId) ||
          (input.outcomeCode === 'imported' && item.action !== 'create') ||
          (input.outcomeCode === 'relinked' && item.action !== 'relink')
        ) {
          return 'lost' as const
        }
        const presentation = getImportOutcomePresentation(input.outcomeCode)
        if (!presentation) throw new Error('unknown google import receipt outcome')

        const [parent] = await tx
          .select({ firstTerminalAt: gbpImportRequests.firstTerminalAt })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, item.importJobId),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent) return 'lost' as const

        await tx
          .update(gbpImportRequestItems)
          .set({
            status: presentation.status,
            outcomeCode: input.outcomeCode,
            connectionId: null,
            existingPropertyId: null,
            destinationPropertyId: null,
            expectedConnectionLifecycleVersion: null,
            expectedConnectionAccessVersion: null,
            expectedCredentialGeneration: null,
            providerAccountSuffix: null,
            providerLocationSuffix: null,
            googleReviewUri: null,
            approvalBindingId: null,
            expectedExecutionPolicyVersion: null,
            expectedGoogleContentPolicyVersion: null,
            expectedEmergencyKillVersion: null,
            expectedActorRole: null,
            expectedPermissionDigest: null,
            expectedSourceEpoch: null,
            expectedProfileVersion: null,
            claimFence: null,
            claimLeaseExpiresAt: null,
            firstTerminalAt: item.firstTerminalAt ?? input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
            ),
          )

        const rows = await tx
          .select({
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, item.importJobId),
            ),
          )
        const reduction = reduceGoogleImportParent({
          items: rows,
          firstTerminalAt: parent.firstTerminalAt,
          now: input.now,
        })
        await tx
          .update(gbpImportRequests)
          .set({ ...parentPatch(reduction), updatedAt: input.now })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, item.importJobId),
            ),
          )
        return 'completed' as const
      }),

    completeClaim: async (input) =>
      db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            importJobId: gbpImportRequestItems.importJobId,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              eq(gbpImportRequestItems.claimFence, input.claimFence),
              eq(gbpImportRequestItems.status, 'processing'),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return 'lost' as const
        const presentation = getImportOutcomePresentation(input.outcomeCode)
        if (!presentation) throw new Error('unknown google import outcome')
        if (
          input.retainProtectedRouting &&
          input.outcomeCode !== 'temporarily_unavailable'
        ) {
          throw new Error(
            'protected google import routing may only survive retryable failure',
          )
        }
        await tx
          .update(gbpImportRequestItems)
          .set({
            status: presentation.status,
            outcomeCode: input.outcomeCode,
            connectionId: input.retainProtectedRouting ? undefined : null,
            existingPropertyId: input.retainProtectedRouting ? undefined : null,
            destinationPropertyId: input.retainProtectedRouting ? undefined : null,
            expectedConnectionLifecycleVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedConnectionAccessVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedCredentialGeneration: input.retainProtectedRouting ? undefined : null,
            providerAccountSuffix: input.retainProtectedRouting ? undefined : null,
            providerLocationSuffix: input.retainProtectedRouting ? undefined : null,
            googleReviewUri: input.retainProtectedRouting ? undefined : null,
            approvalBindingId: input.retainProtectedRouting ? undefined : null,
            expectedExecutionPolicyVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedGoogleContentPolicyVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedEmergencyKillVersion: input.retainProtectedRouting ? undefined : null,
            expectedActorRole: input.retainProtectedRouting ? undefined : null,
            expectedPermissionDigest: input.retainProtectedRouting ? undefined : null,
            expectedSourceEpoch: input.retainProtectedRouting ? undefined : null,
            expectedProfileVersion: input.retainProtectedRouting ? undefined : null,
            claimFence: null,
            claimLeaseExpiresAt: null,
            firstTerminalAt: sql`coalesce(${gbpImportRequestItems.firstTerminalAt}, ${input.now})`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              eq(gbpImportRequestItems.claimFence, input.claimFence),
            ),
          )
        const [parent] = await tx
          .select({ firstTerminalAt: gbpImportRequests.firstTerminalAt })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, current.importJobId),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent) throw new Error('google import parent missing')
        const rows = await tx
          .select({
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, current.importJobId),
            ),
          )
        const reduction = reduceGoogleImportParent({
          items: rows,
          firstTerminalAt: parent.firstTerminalAt,
          now: input.now,
        })
        await tx
          .update(gbpImportRequests)
          .set({ ...parentPatch(reduction), updatedAt: input.now })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, current.importJobId),
            ),
          )
        return 'completed' as const
      }),

    terminalizeItem: async (input) =>
      db.transaction(async (tx) => {
        if (
          input.retainProtectedRouting &&
          input.outcomeCode !== 'temporarily_unavailable'
        ) {
          throw new Error(
            'protected google import routing may only survive retryable failure',
          )
        }
        const [current] = await tx
          .select({
            importJobId: gbpImportRequestItems.importJobId,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              or(
                sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
                eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
              ),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return 'lost' as const
        const presentation = getImportOutcomePresentation(input.outcomeCode)
        if (!presentation) throw new Error('unknown google import outcome')
        const [parent] = await tx
          .select({ firstTerminalAt: gbpImportRequests.firstTerminalAt })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, current.importJobId),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent) return 'lost' as const
        await tx
          .update(gbpImportRequestItems)
          .set({
            status: presentation.status,
            outcomeCode: input.outcomeCode,
            connectionId: input.retainProtectedRouting ? undefined : null,
            existingPropertyId: input.retainProtectedRouting ? undefined : null,
            destinationPropertyId: input.retainProtectedRouting ? undefined : null,
            expectedConnectionLifecycleVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedConnectionAccessVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedCredentialGeneration: input.retainProtectedRouting ? undefined : null,
            providerAccountSuffix: input.retainProtectedRouting ? undefined : null,
            providerLocationSuffix: input.retainProtectedRouting ? undefined : null,
            googleReviewUri: input.retainProtectedRouting ? undefined : null,
            approvalBindingId: input.retainProtectedRouting ? undefined : null,
            expectedExecutionPolicyVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedGoogleContentPolicyVersion: input.retainProtectedRouting
              ? undefined
              : null,
            expectedEmergencyKillVersion: input.retainProtectedRouting ? undefined : null,
            expectedActorRole: input.retainProtectedRouting ? undefined : null,
            expectedPermissionDigest: input.retainProtectedRouting ? undefined : null,
            expectedSourceEpoch: input.retainProtectedRouting ? undefined : null,
            expectedProfileVersion: input.retainProtectedRouting ? undefined : null,
            claimFence: null,
            claimLeaseExpiresAt: null,
            firstTerminalAt: sql`coalesce(${gbpImportRequestItems.firstTerminalAt}, ${input.now})`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              or(
                sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
                eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
              ),
            ),
          )
        const rows = await tx
          .select({
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
          })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, current.importJobId),
            ),
          )
        const reduction = reduceGoogleImportParent({
          items: rows,
          firstTerminalAt: parent.firstTerminalAt,
          now: input.now,
        })
        await tx
          .update(gbpImportRequests)
          .set({ ...parentPatch(reduction), updatedAt: input.now })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, current.importJobId),
            ),
          )
        return 'completed' as const
      }),
    listPendingDispatchItems: async (organizationId, importJobId) => {
      const [parent] = await db
        .select({
          id: gbpImportRequests.id,
          status: gbpImportRequests.status,
        })

        .from(gbpImportRequests)
        .where(
          and(
            eq(gbpImportRequests.organizationId, organizationId),
            eq(gbpImportRequests.id, importJobId),
          ),
        )
        .limit(1)
      if (!parent) return null
      if (!ACTIVE_STATUSES.has(parent.status)) return []

      const rows = await db
        .select({
          itemId: gbpImportRequestItems.id,
          expectedConnectionLifecycleVersion:
            gbpImportRequestItems.expectedConnectionLifecycleVersion,
          expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
          retryRevision: gbpImportRequestItems.retryRevision,
          processingRegion: gbpImportRequestItems.processingRegion,
          routingPolicyVersion: gbpImportRequestItems.routingPolicyVersion,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, organizationId),
            eq(gbpImportRequestItems.importJobId, importJobId),
            eq(gbpImportRequestItems.status, 'pending'),
          ),
        )
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(100)
      return rows.flatMap((row) =>
        row.expectedConnectionLifecycleVersion === null
          ? []
          : [
              {
                ...row,
                expectedConnectionLifecycleVersion:
                  row.expectedConnectionLifecycleVersion,
              },
            ],
      )
    },

    listRetryCandidates: async (organizationId, userId, importJobId, now) => {
      const rows = await db
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          importJobId: gbpImportRequestItems.importJobId,
          sagaId: gbpImportRequests.sagaId,
          itemId: gbpImportRequestItems.id,
          initiatedBy: gbpImportRequests.initiatedBy,
          connectionId: gbpImportRequestItems.connectionId,
          existingPropertyId: gbpImportRequestItems.existingPropertyId,
          expectedConnectionLifecycleVersion:
            gbpImportRequestItems.expectedConnectionLifecycleVersion,
          expectedConnectionAccessVersion:
            gbpImportRequestItems.expectedConnectionAccessVersion,
          expectedCredentialGeneration:
            gbpImportRequestItems.expectedCredentialGeneration,
          approvalBindingId: gbpImportRequestItems.approvalBindingId,
          expectedExecutionPolicyVersion:
            gbpImportRequestItems.expectedExecutionPolicyVersion,
          expectedGoogleContentPolicyVersion:
            gbpImportRequestItems.expectedGoogleContentPolicyVersion,
          expectedEmergencyKillVersion:
            gbpImportRequestItems.expectedEmergencyKillVersion,
          expectedActorRole: gbpImportRequestItems.expectedActorRole,
          expectedPermissionDigest: gbpImportRequestItems.expectedPermissionDigest,
          expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
          expectedProfileVersion: gbpImportRequestItems.expectedProfileVersion,
          providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
          providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
        })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, organizationId),
            or(
              eq(gbpImportRequestItems.importJobId, importJobId),
              eq(gbpImportRequests.sagaId, importJobId),
            ),
            eq(gbpImportRequests.initiatedBy, userId),
            eq(gbpImportRequestItems.status, 'failed'),
            eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
            sql`${gbpImportRequestItems.connectionId} IS NOT NULL`,
            sql`${gbpImportRequestItems.providerAccountSuffix} IS NOT NULL`,
            sql`${gbpImportRequestItems.providerLocationSuffix} IS NOT NULL`,
            sql`${gbpImportRequestItems.effectDeadlineAt} > ${now}`,
            sql`(${gbpImportRequests.purgeAt} IS NULL OR ${gbpImportRequests.purgeAt} > ${now})`,
          ),
        )
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
      return rows.flatMap((row) => {
        const authorization = authorizationFromRow(row)
        return authorization && row.connectionId
          ? [
              {
                importJobId: row.sagaId ?? row.importJobId,
                itemId: row.itemId,
                connectionId: row.connectionId,
                existingPropertyId: row.existingPropertyId,
                expectedSourceEpoch: row.expectedSourceEpoch,
                expectedProfileVersion: row.expectedProfileVersion,
                authorization,
              },
            ]
          : []
      })
    },

    listExpiredItems: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          itemId: gbpImportRequestItems.id,
          retryRevision: gbpImportRequestItems.retryRevision,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
            lte(gbpImportRequestItems.effectDeadlineAt, now),
          ),
        )
        .orderBy(
          asc(gbpImportRequestItems.effectDeadlineAt),
          asc(gbpImportRequestItems.id),
        )
        .limit(limit)
    },

    // Claim-lease recovery selection. A row is stale exactly when it is still
    // 'processing' and its lease instant has passed — equality is expired, the
    // same boundary claimItem/runClaimedEffect use, so the reaper can never
    // preempt a lease those paths still consider live. The schema check
    // guarantees a 'processing' row has a non-null fence and an attempt
    // ordinal in 1..5, so the projected fence is always present.
    // Reads through the partial `(effect_deadline_at, id)` index's
    // pending/processing subset — the active-item working set, not the table.
    listStaleClaimItems: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          itemId: gbpImportRequestItems.id,
          retryRevision: gbpImportRequestItems.retryRevision,
          claimFence: gbpImportRequestItems.claimFence,
          attemptOrdinal: gbpImportRequestItems.highestAttemptForRevision,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            eq(gbpImportRequestItems.status, 'processing'),
            isNotNull(gbpImportRequestItems.claimFence),
            lte(gbpImportRequestItems.claimLeaseExpiresAt, now),
          ),
        )
        .orderBy(
          asc(gbpImportRequestItems.claimLeaseExpiresAt),
          asc(gbpImportRequestItems.id),
        )
        .limit(limit)
      return rows.flatMap((row) =>
        row.claimFence === null
          ? []
          : [
              {
                organizationId: row.organizationId,
                itemId: row.itemId,
                retryRevision: row.retryRevision,
                claimFence: row.claimFence,
                attemptOrdinal: row.attemptOrdinal,
              },
            ],
      )
    },

    listPurgeCandidates: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .select({
          organizationId: gbpImportRequests.organizationId,
          importJobId: gbpImportRequests.id,
          deletionFence: gbpImportRequests.deletionFence,
        })
        .from(gbpImportRequests)
        .where(
          and(
            sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
            lte(gbpImportRequests.purgeAt, now),
          ),
        )
        .orderBy(asc(gbpImportRequests.purgeAt), asc(gbpImportRequests.id))
        .limit(limit)
    },

    purgeParent: async (input) =>
      db.transaction(async (tx) => {
        const itemRows = await tx
          .select({ itemId: gbpImportRequestItems.id })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, input.importJobId),
            ),
          )
          .orderBy(asc(gbpImportRequestItems.id))
          .for('update')
          .limit(101)
        if (itemRows.length < 1 || itemRows.length > 100) return 'lost' as const

        const [parent] = await tx
          .select({
            totalCount: gbpImportRequests.totalCount,
            sagaId: gbpImportRequests.sagaId,
          })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
              sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
              lte(gbpImportRequests.purgeAt, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent || parent.totalCount !== itemRows.length) return 'lost' as const

        const [fenced] = await tx
          .update(gbpImportRequests)
          .set({
            deletionFence: input.expectedDeletionFence + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
            ),
          )
          .returning({ id: gbpImportRequests.id })
        if (!fenced) return 'lost' as const

        const itemIds = itemRows.map((row) => row.itemId)
        await insertOutboxRow(
          tx,
          retentionReleasedEvent({
            eventId: input.outboxEventId,
            organizationId: input.organizationId,
            importJobId: input.importJobId,
            itemIds,
            now: input.now,
          }),
          { recordedAt: input.now },
        )
        const [deleted] = await tx
          .delete(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence + 1),
            ),
          )
          .returning({ id: gbpImportRequests.id })
        if (!deleted) return 'lost' as const
        if (parent.sagaId) {
          await tx.delete(gbpImportSagas).where(
            and(
              eq(gbpImportSagas.organizationId, input.organizationId),
              eq(gbpImportSagas.id, parent.sagaId),
              sql`NOT EXISTS (
                  SELECT 1
                  FROM ${gbpImportRequests}
                  WHERE ${gbpImportRequests.organizationId} = ${input.organizationId}
                    AND ${gbpImportRequests.sagaId} = ${parent.sagaId}
                )`,
            ),
          )
        }
        return 'purged' as const
      }),

    listLifecycleScopeParents: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .selectDistinct({
          organizationId: gbpImportRequests.organizationId,
          importJobId: gbpImportRequests.id,
        })
        .from(gbpImportRequests)
        .innerJoin(
          gbpImportRequestItems,
          and(
            eq(gbpImportRequestItems.organizationId, gbpImportRequests.organizationId),
            eq(gbpImportRequestItems.importJobId, gbpImportRequests.id),
          ),
        )
        .where(
          and(
            lifecycleScopePredicate(scope),
            isNotNull(gbpImportRequests.wireReplayDigest),
          ),
        )
        .orderBy(asc(gbpImportRequests.id))
        .limit(limit)
    },

    fenceLifecycleParent: async (input) => {
      const [fenced] = await db
        .update(gbpImportRequests)
        .set({
          deletionFence: sql`${gbpImportRequests.deletionFence} + 1`,
          wireReplayKeyVersion: null,
          wireReplayDigest: null,
          semanticReplayKeyVersion: null,
          semanticReplayDigest: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(gbpImportRequests.organizationId, input.organizationId),
            eq(gbpImportRequests.id, input.importJobId),
            isNotNull(gbpImportRequests.wireReplayDigest),
          ),
        )
        .returning({ id: gbpImportRequests.id })
      return fenced ? ('fenced' as const) : ('lost' as const)
    },

    listLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          importJobId: gbpImportRequestItems.importJobId,
          itemId: gbpImportRequestItems.id,
          retryRevision: gbpImportRequestItems.retryRevision,
          status: gbpImportRequestItems.status,
          outcomeCode: gbpImportRequestItems.outcomeCode,
        })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(and(lifecycleScopePredicate(scope), lifecycleAuthorityPresent))
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(limit)
      return rows.map((row) => ({
        organizationId: row.organizationId,
        importJobId: row.importJobId,
        itemId: row.itemId,
        retryRevision: row.retryRevision,
        active:
          row.status === 'pending' ||
          row.status === 'processing' ||
          row.outcomeCode === 'temporarily_unavailable',
      }))
    },

    scrubLifecycleItems: async (input) => {
      const itemIds = [...new Set(input.itemIds)]
      if (itemIds.length < 1 || itemIds.length > 100) {
        throw new Error('google import lifecycle scrub requires 1 to 100 unique items')
      }
      const rows = await db
        .update(gbpImportRequestItems)
        .set({
          connectionId: null,
          existingPropertyId: null,
          destinationPropertyId: null,
          providerAccountSuffix: null,
          providerLocationSuffix: null,
          googleReviewUri: null,
          expectedConnectionLifecycleVersion: null,
          expectedConnectionAccessVersion: null,
          expectedCredentialGeneration: null,
          approvalBindingId: null,
          expectedExecutionPolicyVersion: null,
          expectedGoogleContentPolicyVersion: null,
          expectedEmergencyKillVersion: null,
          expectedActorRole: null,
          expectedPermissionDigest: null,
          expectedSourceEpoch: null,
          expectedProfileVersion: null,
          claimFence: null,
          claimLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, input.organizationId),
            inArray(gbpImportRequestItems.id, itemIds),
            sql`${gbpImportRequestItems.status} NOT IN ('pending', 'processing')`,
            sql`${gbpImportRequestItems.outcomeCode} <> 'temporarily_unavailable'`,
          ),
        )
        .returning({ id: gbpImportRequestItems.id })
      return rows.length
    },

    countLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({ itemId: gbpImportRequestItems.id })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(and(lifecycleScopePredicate(scope), lifecycleAuthorityPresent))
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(limit)
      return rows.length
    },

    getOperatorProgress: (organizationId, importJobId) =>
      loadProgress(db, organizationId, importJobId, clock),

    getProgress: (organizationId, userId, importJobId) =>
      loadProgress(db, organizationId, importJobId, clock, userId),
  })
}
