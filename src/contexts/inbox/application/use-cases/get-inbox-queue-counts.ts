import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { queueToFilters, type InboxQueue } from '../inbox-queues'
import {
  findScopeReplyStages,
  NO_REPLY_STAGES,
  resolveInboxCountScope,
} from '../inbox-count-scope'
import type { InboxRepository } from '../ports/inbox.repository'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'

/**
 * What the rail badges. `reply` is "Needs reply" with reply stages and "Open"
 * (every open Review) without them, so it is always counted; `approval` and
 * `waiting` exist only with the stages. The closed folders are never counted
 * (ADR 0057, amended 2026-10-28): they are archives, not work, and carry no badge.
 */
export type InboxQueueCounts = Readonly<{
  reply: number
  approval: number | null
  waiting: number | null
  feedback: number
  escalated: number
  mine: number
  open: number
  replied: null
  handled: null
  closed: null
}>

export type GetInboxQueueCountsInput = Readonly<{
  propertyId?: string
  /** Trusted boundary decision; false keeps unrelated Inbox queues available. */
  replyQueuesEnabled?: boolean
}>

export type GetInboxQueueCountsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  replyLookup: ReplyLookupPort
}>

export type GetInboxQueueCounts = (
  input: GetInboxQueueCountsInput,
  ctx: AuthContext,
) => Promise<InboxQueueCounts>

function emptyCounts(canManageReplies: boolean): InboxQueueCounts {
  return {
    reply: 0,
    approval: canManageReplies ? 0 : null,
    waiting: canManageReplies ? 0 : null,
    feedback: 0,
    escalated: 0,
    mine: 0,
    open: 0,
    replied: null,
    handled: null,
    closed: null,
  }
}

export const getInboxQueueCounts =
  (deps: GetInboxQueueCountsDeps): GetInboxQueueCounts =>
  async (input, ctx) => {
    const canManageReplies =
      input.replyQueuesEnabled !== false && canForContext(ctx, 'reply.manage')
    const scope = await resolveInboxCountScope(deps.staffPublicApi, ctx, input.propertyId)
    if (scope === null) return emptyCounts(canManageReplies)

    const replyStages = canManageReplies
      ? await findScopeReplyStages(deps.replyLookup, ctx, scope)
      : NO_REPLY_STAGES

    const count = (queue: InboxQueue) =>
      deps.repo.countFiltered(
        {
          ...queueToFilters(queue, {
            viewerId: ctx.userId,
            canManageReplies,
            replyStages,
          }),
          propertyIds: scope.propertyIds,
          sourceScopes: scope.sourceScopes,
        },
        ctx.organizationId,
      )

    // The stages need reply.manage; without them only the queues that do not
    // depend on a reply are counted (five queries instead of seven).
    const stageCount = (queue: InboxQueue) =>
      canManageReplies ? count(queue) : Promise.resolve(null)

    const [reply, approval, waiting, feedback, escalated, mine, open] = await Promise.all(
      [
        count('reply'),
        stageCount('approval'),
        stageCount('waiting'),
        count('feedback'),
        count('escalated'),
        count('mine'),
        count('open'),
      ],
    )
    return {
      reply,
      approval,
      waiting,
      feedback,
      escalated,
      mine,
      open,
      replied: null,
      handled: null,
      closed: null,
    }
  }
