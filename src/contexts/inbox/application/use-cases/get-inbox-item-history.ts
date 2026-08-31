// Inbox context — get Handling History use case (IBX-01-T5/T6).
//
// One ordered manager-facing record of how an Inbox Item was handled, merged
// from Inbox's own append-only tables. Two authorization decisions live here
// and nowhere else, because this is the only layer that knows the caller:
//
//   1. Reading the history at all requires `inbox.read` AND the owning
//      context's read permission for the item's source, in the item's Property
//      scope. A custom role with Inbox access but no `feedback.read` cannot use
//      history as a side door into private feedback handling.
//   2. The manager-internal note recorded with a private-feedback outcome is
//      returned only to a caller who currently holds `inbox.write` AND
//      `feedback.handle` in that same Property. Otherwise the field is ABSENT —
//      not null, not truncated — so an unauthorized reader cannot even learn
//      that a note exists.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { orderInboxHistory, type InboxHistoryEntry } from '../../domain/handling-history'
import {
  assertInboxSourcePropertyAccessible,
  canHandleInboxSource,
  canReadInboxSource,
  isInboxSourcePropertyWithinScopes,
  resolveInboxSourceScopes,
} from '../inbox-access'
import type { InboxActorDirectory } from '../ports/inbox-actor-directory.port'
import type { InboxHistoryRepository } from '../ports/inbox-history.repository'
import type { InboxRepository } from '../ports/inbox.repository'

export type GetInboxItemHistoryInput = Readonly<{
  inboxItemId: InboxItemId
}>

export type GetInboxItemHistoryResult = Readonly<{
  inboxItemId: InboxItemId
  entries: readonly InboxHistoryEntry[]
  /** True when a source hit its LIMIT: the story shown is incomplete. */
  truncated: boolean
}>

export type GetInboxItemHistoryDeps = Readonly<{
  historyRepo: InboxHistoryRepository
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  actorDirectory: InboxActorDirectory
}>

/** Strip the manager-internal note, leaving no trace that one existed. */
function withoutInternalNote(entry: InboxHistoryEntry): InboxHistoryEntry {
  if (entry.detail.kind !== 'handling_outcome') return entry
  const { internalNote: _withheld, ...rest } = entry.detail
  return { ...entry, detail: rest }
}

function actorIdsOf(entry: InboxHistoryEntry): readonly UserId[] {
  const ids = entry.actorUserId === null ? [] : [entry.actorUserId]
  if (entry.detail.kind !== 'assignment') return ids
  return [
    ...ids,
    ...(entry.detail.previousAssignee === null ? [] : [entry.detail.previousAssignee]),
    ...(entry.detail.nextAssignee === null ? [] : [entry.detail.nextAssignee]),
  ]
}

function withDisplayNames(
  entry: InboxHistoryEntry,
  names: ReadonlyMap<UserId, string>,
): InboxHistoryEntry {
  const actorDisplayName =
    entry.actorUserId === null ? null : (names.get(entry.actorUserId) ?? null)
  if (entry.detail.kind !== 'assignment') return { ...entry, actorDisplayName }
  const { previousAssignee, nextAssignee } = entry.detail
  return {
    ...entry,
    actorDisplayName,
    detail: {
      ...entry.detail,
      previousAssigneeDisplayName:
        previousAssignee === null ? null : (names.get(previousAssignee) ?? null),
      nextAssigneeDisplayName:
        nextAssignee === null ? null : (names.get(nextAssignee) ?? null),
    },
  }
}

export const getInboxItemHistory =
  (deps: GetInboxItemHistoryDeps) =>
  async (
    input: GetInboxItemHistoryInput,
    ctx: AuthContext,
  ): Promise<GetInboxItemHistoryResult> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'Insufficient role to read Inbox history')
    }

    const item = await deps.repo.findById(input.inboxItemId, ctx.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }
    // Both halves of the source permission are checked before the history store
    // is touched at all: a denied caller must not be able to time the read.
    if (!canReadInboxSource(ctx, item.sourceType)) {
      throw inboxError('forbidden', 'No access to this inbox source')
    }
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'read',
      item.sourceType,
      item.propertyId,
    )

    // Handling authority is evaluated non-throwingly: lacking it hides the
    // internal note, it does not deny the history.
    const handleScopes = canHandleInboxSource(ctx, item.sourceType)
      ? await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'handle')
      : []
    const mayReadInternalNote = isInboxSourcePropertyWithinScopes(
      handleScopes,
      item.sourceType,
      item.propertyId,
    )

    const page = await deps.historyRepo.findByInboxItemId({
      inboxItemId: input.inboxItemId,
      organizationId: ctx.organizationId,
    })
    const projected = mayReadInternalNote
      ? page.entries
      : page.entries.map(withoutInternalNote)

    // Exactly one directory call per request, regardless of entry count.
    const actorIds = [...new Set(projected.flatMap(actorIdsOf))]
    const names = await deps.actorDirectory.resolveDisplayNames(
      ctx.organizationId,
      actorIds,
    )

    return {
      inboxItemId: input.inboxItemId,
      // Re-ordered here as well as in the repository: the total order is the
      // use case's contract with its callers, and it must not depend on which
      // repository implementation answered.
      entries: orderInboxHistory(
        projected.map((entry) => withDisplayNames(entry, names)),
      ),
      truncated: page.truncated,
    }
  }

export type GetInboxItemHistory = ReturnType<typeof getInboxItemHistory>
