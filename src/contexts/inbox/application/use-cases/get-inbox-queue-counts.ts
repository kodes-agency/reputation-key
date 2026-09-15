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

export type InboxQueueCounts = Readonly<{
  reply: number | null
  approval: number | null
  waiting: number | null
  feedback: number
  escalated: number
  mine: number
  closed: number
  open: number
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
    reply: canManageReplies ? 0 : null,
    approval: canManageReplies ? 0 : null,
    waiting: canManageReplies ? 0 : null,
    feedback: 0,
    escalated: 0,
    mine: 0,
    closed: 0,
    open: 0,
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

    if (!canManageReplies) {
      const [feedback, escalated, mine, closed, open] = await Promise.all([
        count('feedback'),
        count('escalated'),
        count('mine'),
        count('closed'),
        count('open'),
      ])
      return {
        reply: null,
        approval: null,
        waiting: null,
        feedback,
        escalated,
        mine,
        closed,
        open,
      }
    }

    const [reply, approval, waiting, feedback, escalated, mine, closed, open] =
      await Promise.all([
        count('reply'),
        count('approval'),
        count('waiting'),
        count('feedback'),
        count('escalated'),
        count('mine'),
        count('closed'),
        count('open'),
      ])
    return { reply, approval, waiting, feedback, escalated, mine, closed, open }
  }
