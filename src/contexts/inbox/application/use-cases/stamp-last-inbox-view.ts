// Inbox context — stamp last-visit timestamp use case
// Called on inbox page load (ADR 0023). Updates the per-user `lastInboxView`
// so the sidebar badge subsequently reflects only items newer than this visit.

import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'

export type StampLastInboxViewInput = Readonly<{
  /** Cutoff issued with the successfully loaded first Inbox page. */
  responseCutoff: Date
}>

export type StampLastInboxViewDeps = Readonly<{
  viewRepo: InboxViewRepository
  clock: () => Date
}>

export type StampLastInboxView = (
  input: StampLastInboxViewInput,
  ctx: AuthContext,
) => Promise<Date>

export const stampLastInboxView =
  (deps: StampLastInboxViewDeps): StampLastInboxView =>
  async (input, ctx) => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }
    const now = deps.clock()
    if (
      Number.isNaN(input.responseCutoff.getTime()) ||
      input.responseCutoff.getTime() > now.getTime()
    ) {
      throw inboxError('invalid_input', 'Inbox response cutoff is invalid')
    }
    return deps.viewRepo.stampLastInboxView(
      ctx.organizationId,
      ctx.userId,
      input.responseCutoff,
    )
  }
