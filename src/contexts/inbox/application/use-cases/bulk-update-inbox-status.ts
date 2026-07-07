// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items.

import type { InboxRepository } from '../ports/inbox.repository'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { InboxItem, InboxStatus } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
import { inboxError } from '../../domain/errors'
import { inboxItemBulkStatusChanged, inboxItemEscalated } from '../../domain/events'
import { can } from '#/shared/domain/permissions'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  newCounter: NewCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
}>

// `accessible` is null for AccountAdmin (no filtering); an explicit list for
// PropertyManager/Staff (scoped). `ok: false` means access resolution failed
// and the whole operation must no-op. (PM holds inbox.manage but is NOT
// org-wide — CONTEXT.md L72.)
type AccessResolution = Readonly<
  { ok: true; accessible: ReadonlyArray<PropertyId> | null } | { ok: false }
>

/** Resolves the accessible-property filter once for the whole batch. On lookup
 *  failure, fails safe (`ok: false`) so the caller updates nothing. */
const resolveAccessiblePropertyIds = async (
  deps: BulkUpdateInboxStatusDeps,
  input: BulkUpdateInboxStatusInput,
): Promise<AccessResolution> => {
  if (input.role === 'AccountAdmin') return { ok: true, accessible: null }
  try {
    return {
      ok: true,
      accessible: await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        false,
      ),
    }
  } catch (err) {
    deps.logger.warn(
      { err, organizationId: input.organizationId },
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
    // Defense-in-depth: skip reviews for bulk 'addressed'
    // (reviews auto-transition via reply.published)
    if (newStatus === 'addressed' && item.sourceType === 'review') continue
    // Enforce role-scoped property access (using pre-computed list)
    if (accessible !== null && !accessible.includes(item.propertyId)) continue
    if (validateTransition(item.status, newStatus).isOk()) {
      validIds.push(id)
      oldStatuses.set(id, item.status)
    }
  }
  return { validIds, oldStatuses }
}

/** Emits the per-item bulk_status_changed (and, when escalating, the escalated)
 *  events. Mirrors the single-item path so notifications fire identically. */
const emitBulkStatusEvents = async (
  deps: BulkUpdateInboxStatusDeps,
  items: ReadonlyArray<InboxItem>,
  validIds: ReadonlyArray<InboxItemId>,
  oldStatuses: ReadonlyMap<InboxItemId, InboxStatus>,
  input: BulkUpdateInboxStatusInput,
  bulkId: string,
  now: Date,
): Promise<void> => {
  for (const id of validIds) {
    const oldItem = items.find((i) => i.id === id)
    await deps.events.emit(
      inboxItemBulkStatusChanged({
        inboxItemId: id,
        organizationId: input.organizationId,
        propertyId: oldItem?.propertyId ?? ('' as PropertyId),
        oldStatus: oldStatuses.get(id)!,
        newStatus: input.newStatus,
        bulkId,
        userId: input.userId,
        occurredAt: now,
      }),
    )
    if (input.newStatus === 'escalated') {
      await deps.events.emit(
        inboxItemEscalated({
          inboxItemId: id,
          organizationId: input.organizationId,
          propertyId: oldItem?.propertyId ?? ('' as PropertyId),
          oldStatus: oldStatuses.get(id)!,
          userId: input.userId,
          occurredAt: now,
        }),
      )
    }
  }
}

export const bulkUpdateInboxStatus =
  (deps: BulkUpdateInboxStatusDeps) =>
  async (input: BulkUpdateInboxStatusInput): Promise<{ updated: number }> => {
    if (!can(input.role, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')
    const now = deps.clock()
    const bulkId = crypto.randomUUID()

    // 1. Resolve accessible-property filter once for the whole batch
    const access = await resolveAccessiblePropertyIds(deps, input)
    if (!access.ok) return { updated: 0 }

    // 2. Batch-fetch all items (eliminates N+1) and select valid candidates
    const items = await deps.repo.findByIds(input.inboxItemIds, input.organizationId)
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
      input.organizationId,
      input.newStatus,
      timestampFieldsForStatus(input.newStatus, now),
      now,
    )

    // 4. Decrement new counter for items transitioning away from 'new'
    //    (single bulk decrement instead of O(n) individual calls)
    if (input.newStatus !== 'new') {
      const newCount = validIds.filter((id) => oldStatuses.get(id) === 'new').length
      if (newCount > 0) {
        try {
          await deps.newCounter.decrementBy(input.organizationId, newCount)
        } catch (err) {
          deps.logger.warn(
            { err, organizationId: input.organizationId },
            'New counter bulk decrement failed, DB is source of truth',
          )
        }
      }
    }

    // 5. Emit per-item events
    await emitBulkStatusEvents(deps, items, validIds, oldStatuses, input, bulkId, now)

    return result
  }

// fallow-ignore-next-line unused-type
export type BulkUpdateInboxStatus = ReturnType<typeof bulkUpdateInboxStatus>
