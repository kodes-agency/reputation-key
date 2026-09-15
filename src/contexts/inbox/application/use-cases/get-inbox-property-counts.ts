// Inbox context — one queue, counted per property.
//
// Properties are the Inbox's second axis: the queue rail says what the work is,
// the property section says whose it is. Its counts belong to the queue the
// viewer is in, not to the property on screen, so they are read across every
// property the viewer can see and do not narrow when the scope does.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxError } from '../../domain/errors'
import {
  findScopeReplyStages,
  NO_REPLY_STAGES,
  resolveInboxCountScope,
} from '../inbox-count-scope'
import { queueToFilters, REPLY_STAGE_QUEUES, type InboxQueue } from '../inbox-queues'
import type { InboxRepository } from '../ports/inbox.repository'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'

export type InboxPropertyCounts = Readonly<{
  queue: InboxQueue
  /** The queue across every visible property — the "All properties" count. */
  total: number
  /** Keyed by property id. A property with nothing in the queue is absent. */
  byProperty: Readonly<Record<string, number>>
}>

export type GetInboxPropertyCountsInput = Readonly<{ queue: InboxQueue }>

export type GetInboxPropertyCountsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  replyLookup: ReplyLookupPort
}>

export type GetInboxPropertyCounts = (
  input: GetInboxPropertyCountsInput,
  ctx: AuthContext,
) => Promise<InboxPropertyCounts>

export const getInboxPropertyCounts =
  (deps: GetInboxPropertyCountsDeps): GetInboxPropertyCounts =>
  async ({ queue }, ctx) => {
    const isReplyStageQueue = REPLY_STAGE_QUEUES.has(queue)
    const canManageReplies = canForContext(ctx, 'reply.manage')
    // Refused before any read, with the list's own error for the same queue.
    if (isReplyStageQueue && !canManageReplies) {
      throw inboxError('forbidden', 'Reply queues require reply.manage')
    }

    const scope = await resolveInboxCountScope(deps.staffPublicApi, ctx)
    if (scope === null) return { queue, total: 0, byProperty: {} }

    const replyStages = isReplyStageQueue
      ? await findScopeReplyStages(deps.replyLookup, ctx, scope)
      : NO_REPLY_STAGES
    const rows = await deps.repo.countFilteredByProperty(
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

    return {
      queue,
      total: rows.reduce((sum, row) => sum + row.count, 0),
      byProperty: Object.fromEntries(rows.map((row) => [row.propertyId, row.count])),
    }
  }
