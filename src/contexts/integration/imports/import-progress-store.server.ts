import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import type { Clock } from '#/shared/domain/clock'
import {
  GBP_IMPORT_ITEM_STATUSES,
  GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
  IMPORT_OUTCOME_PRESENTATION,
  getImportOutcomePresentation,
  isImportProfileField,
  type GbpImportItemStatus,
  type ImportParentStatus,
  type ImportProgressDto,
  type ImportProgressItemDto,
} from '../application/google-import-contract'
import { googleImportProgressPollAfterMs } from './import-progress-policy.server'
import { parentScope } from './import-store-helpers.server'

type Item = typeof googleImportItems.$inferSelect

function progressItem(row: Item): ImportProgressItemDto {
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
    status: row.status,
    outcomeCode: row.outcomeCode,
    messageKey: `property_import.${row.outcomeCode ?? row.status}`,
    retryable,
    retryRevision: row.retryRevision,
    userAction: retryable ? (presentation?.userAction ?? 'none') : 'none',
    propertyId: ['imported', 'relinked', 'already_exists'].includes(row.status)
      ? row.destinationPropertyId
      : null,
    invalidProfileField:
      row.outcomeCode === 'tenant_profile_invalid' &&
      isImportProfileField(row.invalidProfileField)
        ? row.invalidProfileField
        : null,
  }
}

/** Counts and outcomes come from checkpoints; there are no writable progress counters. */
export async function getImportProgress(
  db: Database,
  organizationId: string,
  importId: string,
  clock: Clock,
  initiatedBy?: string,
): Promise<ImportProgressDto | null> {
  return db.transaction(
    async (tx) => {
      const [parent] = await tx
        .select()
        .from(googleImports)
        .where(
          and(
            parentScope(organizationId, importId),
            initiatedBy === undefined
              ? undefined
              : eq(googleImports.initiatedBy, initiatedBy),
          ),
        )
        .limit(1)
      if (!parent) return null
      const groups = await tx
        .select({
          status: googleImportItems.status,
          outcomeCode: googleImportItems.outcomeCode,
          count: sql<number>`count(*)::integer`,
          attempted: sql<boolean>`bool_or(${googleImportItems.highestAttemptForRevision} > 0)`,
        })
        .from(googleImportItems)
        .where(
          and(
            eq(googleImportItems.organizationId, organizationId),
            eq(googleImportItems.importId, importId),
          ),
        )
        .groupBy(googleImportItems.status, googleImportItems.outcomeCode)
      const counts = Object.fromEntries(
        GBP_IMPORT_ITEM_STATUSES.map((status) => [status, 0]),
      ) as Record<GbpImportItemStatus, number>
      let success = false,
        positive = false,
        failure = false,
        allCancelled = true,
        attempted = parent.firstTerminalAt !== null
      for (const group of groups) {
        counts[group.status] += group.count
        attempted ||= group.attempted
        if (group.outcomeCode) {
          const kind = IMPORT_OUTCOME_PRESENTATION[group.outcomeCode].reducerClass
          success ||= kind === 'success'
          positive ||= kind === 'success' || kind === 'benign_skip'
          failure ||= kind === 'failure'
          allCancelled &&= kind === 'cancellation'
        }
      }
      const totalCount = Object.values(counts).reduce((a, b) => a + b, 0)
      if (totalCount !== parent.totalCount)
        throw new Error('Google import item checkpoint is incomplete')
      const processedCount = totalCount - counts.pending - counts.processing
      const active = counts.pending + counts.processing > 0
      let status: ImportParentStatus
      if (active)
        status = counts.pending === totalCount && !attempted ? 'queued' : 'processing'
      else if (success && counts.imported + counts.relinked === totalCount)
        status = 'completed'
      else if (!positive && allCancelled) status = 'cancelled'
      else if (!positive && failure) status = 'failed'
      else status = 'completed_with_issues'
      const rows = await tx
        .select()
        .from(googleImportItems)
        .where(
          and(
            eq(googleImportItems.organizationId, organizationId),
            eq(googleImportItems.importId, importId),
          ),
        )
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
      const items = rows.map(progressItem)
      return {
        contractVersion: GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
        importJobId: parent.id,
        requestId: parent.requestId,
        status,
        totalCount,
        processedCount,
        counts,
        items,
        canRetry: items.some((item) => item.retryable),
        pollAfterMs: googleImportProgressPollAfterMs(
          status,
          parent.updatedAt.getTime(),
          clock().getTime(),
        ),
        purgeAt: parent.purgeAt?.toISOString() ?? null,
        updatedAt: parent.updatedAt.toISOString(),
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
