// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items (open ⇄ closed per ADR 0023).
// No source-type guards; escalation is orthogonal and handled separately.

import type { InboxRepository } from '../ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, PropertyId } from '#/shared/domain/ids'
import type { InboxItem, InboxStatus } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
import { inboxError } from '../../domain/errors'
import { inboxItemBulkStatusChanged } from '../../domain/events'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  newStatus: InboxStatus
}>

export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
  outboxRepo?: OutboxRepository
}>

export type BulkUpdateInboxStatus = (
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<{ updated: number }>

// `accessible` is null for an org-wide caller (no filtering); an explicit list
// for an assigned-scope caller (PM/Staff). `ok: false` means access resolution
// failed and the whole operation must no-op. (PM holds inbox.manage but is NOT
// org-wide — CONTEXT.md L72.)
type AccessResolution = Readonly<
  { ok: true; accessible: ReadonlyArray<PropertyId> | null } | { ok: false }
>

/** Resolves the accessible-property filter once for the whole batch. On lookup
 *  failure, fails safe (`ok: false`) so the caller updates nothing. */
const resolveAccessiblePropertyIds = async (
  deps: BulkUpdateInboxStatusDeps,
  ctx: AuthContext,
): Promise<AccessResolution> => {
  try {
    return {
      ok: true,
      accessible: await getAccessiblePropertyIdsForPermission(
        (orgId, uId, orgWide) =>
          deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
        ctx,
        'inbox.write',
      ),
    }
  } catch (err) {
    deps.logger.warn(
      { err, organizationId: ctx.organizationId },
      'Access check for property IDs failed, treating as no access',
    )
    return { ok: false }
  }
}

/** Validates each candidate item, collecting the IDs that may transition and
 *  remembering their prior status for event emission. */
const selectValidBulkItems = (
  items: ReadonlyArray<InboxItem>,
  ids: ReadonlyArray<InboxItemId>,
  newStatus: InboxStatus,
  accessible: ReadonlyArray<PropertyId> | null,
): { validIds: InboxItemId[]; oldStatuses: Map<InboxItemId, InboxStatus> } => {
  const itemMap = new Map(items.map((item) => [item.id as string, item]))
  const validIds: InboxItemId[] = []
  const oldStatuses = new Map<InboxItemId, InboxStatus>()
  for (const id of ids) {
    const item = itemMap.get(id as string)
    if (!item) continue
    // Enforce role-scoped property access (using pre-computed list)
    if (accessible !== null && !accessible.includes(item.propertyId)) continue
    if (validateTransition(item.status, newStatus).isOk()) {
      validIds.push(id)
      oldStatuses.set(id, item.status)
    }
  }
  return { validIds, oldStatuses }
}

/** Emits the per-item bulk_status_changed event. */
const emitBulkStatusEvents = async (
  deps: BulkUpdateInboxStatusDeps,
  items: ReadonlyArray<InboxItem>,
  validIds: ReadonlyArray<InboxItemId>,
  oldStatuses: ReadonlyMap<InboxItemId, InboxStatus>,
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
  bulkId: string,
  now: Date,
): Promise<void> => {
  for (const id of validIds) {
    const oldItem = items.find((i) => i.id === id)
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      inboxItemBulkStatusChanged({
        inboxItemId: id,
        organizationId: ctx.organizationId,
        propertyId: oldItem?.propertyId ?? ('' as PropertyId),
        oldStatus: oldStatuses.get(id)!,
        newStatus: input.newStatus,
        bulkId,
        userId: ctx.userId,
        occurredAt: now,
      }),
    )
  }
}

export const bulkUpdateInboxStatus =
  (deps: BulkUpdateInboxStatusDeps): BulkUpdateInboxStatus =>
  async (input, ctx) => {
    if (!canForContext(ctx, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')
    const now = deps.clock()
    const bulkId = crypto.randomUUID()

    // 1. Resolve accessible-property filter once for the whole batch
    const access = await resolveAccessiblePropertyIds(deps, ctx)
    if (!access.ok) return { updated: 0 }

    // 2. Batch-fetch all items (eliminates N+1) and select valid candidates
    const items = await deps.repo.findByIds(input.inboxItemIds, ctx.organizationId)
    const { validIds, oldStatuses } = selectValidBulkItems(
      items,
      input.inboxItemIds,
      input.newStatus,
      access.accessible,
    )
    if (validIds.length === 0) return { updated: 0 }

    // 3. Bulk update
    const result = await deps.repo.bulkUpdateStatus(
      validIds,
      ctx.organizationId,
      input.newStatus,
      timestampFieldsForStatus(input.newStatus, now),
      now,
    )

    // 4. Emit per-item events
    await emitBulkStatusEvents(
      deps,
      items,
      validIds,
      oldStatuses,
      input,
      ctx,
      bulkId,
      now,
    )

    return result
  }
