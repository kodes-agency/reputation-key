// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items (open ⇄ closed per ADR 0023).
// No source-type guards; escalation is orthogonal and handled separately.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, PropertyId } from '#/shared/domain/ids'
import type { InboxItem, InboxStatus } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition } from '../../domain/rules'
import { inboxError } from '../../domain/errors'
import {
  inboxItemBulkStatusChanged,
  type InboxItemBulkStatusChanged,
} from '../../domain/events'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  newStatus: InboxStatus
}>

export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
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

/** Validates each candidate item, collecting the items that may transition. */
const selectValidBulkItems = (
  items: ReadonlyArray<InboxItem>,
  ids: ReadonlyArray<InboxItemId>,
  newStatus: InboxStatus,
  accessible: ReadonlyArray<PropertyId> | null,
): InboxItem[] => {
  const itemMap = new Map(items.map((item) => [item.id as string, item]))
  const valid: InboxItem[] = []
  for (const id of ids) {
    const item = itemMap.get(id as string)
    if (!item) continue
    // Enforce role-scoped property access (using pre-computed list)
    if (accessible !== null && !accessible.includes(item.propertyId)) continue
    if (validateTransition(item.status, newStatus).isOk()) {
      valid.push(item)
    }
  }
  return valid
}

/** Builds the per-item bulk_status_changed facts (one per item, shared bulkId).
 *  propertyId comes from the batch-fetched item — it is always present. */
const buildBulkStatusEvents = (
  validItems: ReadonlyArray<InboxItem>,
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
  bulkId: string,
  now: Date,
): InboxItemBulkStatusChanged[] =>
  validItems.map((item) =>
    inboxItemBulkStatusChanged({
      inboxItemId: item.id,
      organizationId: ctx.organizationId,
      propertyId: item.propertyId,
      oldStatus: item.status,
      newStatus: input.newStatus,
      bulkId,
      userId: ctx.userId,
      occurredAt: now,
    }),
  )

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
    const validItems = selectValidBulkItems(
      items,
      input.inboxItemIds,
      input.newStatus,
      access.accessible,
    )
    if (validItems.length === 0) return { updated: 0 }

    // 3. ONE bulk update + N per-item facts in one transaction (BQC-3.4).
    return deps.commandStore.bulkUpdateStatus(
      validItems,
      buildBulkStatusEvents(validItems, input, ctx, bulkId, now),
    )
  }
