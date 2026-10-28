// Inbox context — set an item's priority (manager priority, ADR 0071).
//
// A person sets Urgent, High, Medium or Low on any Review or private-feedback
// item, or clears the level they set (`priority: null`), which hands the item
// back to the AI suggestion or to "Not set". Priority is an independent axis
// (ADR 0055 decision 9): it never opens, closes or reopens work, never
// escalates, never notifies and never touches a Response Target. The command
// writes the level, one Handling History row and one audit-only fact.
//
// Two managers at once (plan D-7, owner P-8): an unrelated change in between (a
// note, an assignment) is absorbed by the client's one revision retry, but a
// change to the priority ITSELF is refused with `priority_changed`, which the
// retry does not replay — nobody's choice is overwritten unseen. A colleague
// who already picked the same level makes this a silent no-op, not a refusal.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId } from '#/shared/domain/ids'
import type { InboxItem, InboxPriority } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxItemPriorityChanged } from '../../domain/events'
import { inboxError, PRIORITY_CHANGED_MESSAGE } from '../../domain/errors'
import { loadItemForCommand } from '../inbox-access'

export type SetInboxItemPriorityInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
  /** The level the caller's pane showed as SET (not the suggestion); null for none. */
  expectedPriority: InboxPriority | null
  /** The level to set, or null to clear it. */
  priority: InboxPriority | null
}>

export type SetInboxItemPriorityDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export type SetInboxItemPriority = (
  input: SetInboxItemPriorityInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export const setInboxItemPriority =
  (deps: SetInboxItemPriorityDeps): SetInboxItemPriority =>
  async (input, ctx) => {
    // 1. Write permission, the item, its source and Property scope, then the
    //    revision fence — the order every single-item command shares.
    const item = await loadItemForCommand(deps, input, ctx)
    const current = item.managerPriority ?? null

    // 2. Already at that level, whoever set it: nothing to write — no history
    //    row, no fact, no revision bump.
    if (current === input.priority) return item

    // 3. The level changed since the caller's pane read it: refuse rather than
    //    overwrite a colleague's choice the caller never saw.
    if (current !== input.expectedPriority) {
      throw inboxError('priority_changed', PRIORITY_CHANGED_MESSAGE, {
        inboxItemId: item.id,
        currentCommandRevision: item.commandRevision,
      })
    }

    // 4. The level, its history row and the audit-only fact, atomically.
    const now = deps.clock()
    return deps.commandStore.setPriority(
      item,
      { priority: input.priority, setBy: ctx.userId },
      inboxItemPriorityChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: ctx.userId,
        priority: input.priority,
        previousPriority: current,
        occurredAt: now,
      }),
      now,
    )
  }
