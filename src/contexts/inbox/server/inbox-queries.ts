// Inbox context — query server functions (list, counts)

import {
  getExecutionPolicy,
  refuseDecision,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import {
  createServerFn,
  isInboxError,
  inboxErrorStatus,
  propertyId,
} from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import {
  getInboxItemsDto,
  getLastVisitCountDto,
  stampLastInboxViewDto,
  getInboxQueueCountsDto,
  getInboxPropertyCountsDto,
} from '../application/dto/inbox.dto'
import { decodeInboxCursor } from '../application/inbox-cursor'
import { REPLY_STAGE_QUEUES, type InboxQueue } from '../application/inbox-queues'
import { sourceDateWindow } from '../application/source-date-window'
import type { AuthContext } from '#/shared/domain/auth-context'

/**
 * Whether reply stages are available for this scope: the policy lets the caller
 * manage replies there. The browser draws the rail, its labels and its empty
 * states from this answer (the queue counts carry it as `replyStages`), so every
 * function that answers the question asks it here and asks it the same way.
 *
 * Only a settled "no" (no permission, outside the caller's Properties, reply
 * publication off, a suspension) means there are no stages. A policy that could
 * not answer (`policy_unavailable`: its grant lookup failed) says nothing about
 * them, so it refuses the request as every other policy outage does. Read as
 * "no stages" it served another set than the page was drawn for, under the wrong
 * label, for as long as the outage lasted.
 */
async function replyStagesAvailable(
  ctx: AuthContext,
  propertyId: string | undefined,
): Promise<boolean> {
  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'user', ctx },
    action: 'reply.manage',
    organizationId: ctx.organizationId,
    propertyId,
    executionKind: 'interactive',
    now: getContainer().clock(),
  })
  if (decision.reason === 'policy_unavailable') refuseDecision(decision)
  return decision.allowed
}

/**
 * The stage decision to hand a list or a per-property count, for the queues that
 * involve reply stages. `approval` and `waiting` exist only with the stages, so
 * the policy is required for them and refuses the request. `reply` is also every
 * open Review without the stages (the rail's "Open", ADR 0057 amended
 * 2026-10-28), so its answer is handed to the use case as a boundary decision
 * instead of refusing. A queue that depends on no reply asks nothing.
 */
async function replyQueuesEnabledFor(
  ctx: AuthContext,
  queue: InboxQueue | undefined,
  propertyId: string | undefined,
): Promise<boolean | undefined> {
  if (queue === undefined || !REPLY_STAGE_QUEUES.has(queue)) return undefined
  if (queue !== 'reply') {
    // Allowed past this line, so the use case's default (stages on) is the answer.
    await requireExecutionAllowed({ actor: ctx, action: 'reply.manage', propertyId })
    return undefined
  }
  return replyStagesAvailable(ctx, propertyId)
}

/**
 * The moments a `since`/`until` window starts and ends at. The days are the
 * Property's own, so the Property is asked its timezone; with none named (the
 * whole Inbox) they are read in UTC. Asked after the read permission is held for
 * that Property, and only when a day was named.
 */
async function requestedSourceDates(
  ctx: AuthContext,
  data: Readonly<{ propertyId?: string; since?: string; until?: string }>,
) {
  if (data.since === undefined && data.until === undefined) return {}
  const timezone = data.propertyId
    ? await getContainer().propertyPublicApi.getPropertyTimezone(
        ctx.organizationId,
        propertyId(data.propertyId),
      )
    : null
  return sourceDateWindow({ since: data.since, until: data.until, timezone })
}

// ── getInboxItems ──────────────────────────────────────────────────

export const getInboxItemsFn = createServerFn({ method: 'GET' })
  .validator(getInboxItemsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'inbox.read',
          propertyId: data.propertyId,
        })
        const replyQueuesEnabled = await replyQueuesEnabledFor(
          ctx,
          data.queue,
          data.propertyId,
        )
        const { inboxPublicApi, logger } = getContainer()
        try {
          const sourceDates = await requestedSourceDates(ctx, data)
          const cursor = data.cursor ? decodeInboxCursor(data.cursor) : null
          if (data.cursor && cursor === null) {
            // Do not echo the untrusted cursor into logs.
            logger.warn('inbox: malformed cursor, treating as first page')
          }
          return await inboxPublicApi.getInboxItems(
            {
              queue: data.queue,
              replyQueuesEnabled,
              filters: {
                propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
                status: data.status,
                isEscalated: data.isEscalated,
                sourceType: data.sourceType,
                platform: data.platform,
                ratingMin: data.ratingMin,
                ratingMax: data.ratingMax,
                attention: data.attention
                  ? Array.isArray(data.attention)
                    ? data.attention
                    : [data.attention]
                  : undefined,
                aspect: data.aspect
                  ? Array.isArray(data.aspect)
                    ? data.aspect
                    : [data.aspect]
                  : undefined,
                polarity: data.polarity
                  ? Array.isArray(data.polarity)
                    ? data.polarity
                    : [data.polarity]
                  : undefined,
                issueId: data.issue,
                sourceDateFrom: sourceDates.sourceDateFrom ?? data.sourceDateFrom,
                sourceDateTo: sourceDates.sourceDateTo ?? data.sourceDateTo,
                q: data.q,
                sort: data.sort,
              },
              cursor: cursor ?? undefined,
              limit: data.limit,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getInboxItems',
    ),
  )

// ── getLastVisitCount ──────────────────────────────────────────────

export const getLastVisitCountFn = createServerFn({ method: 'GET' })
  .validator(getLastVisitCountDto)
  .handler(
    tracedHandler(
      async () => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.getLastVisitCount({}, ctx)
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getLastVisitCount',
    ),
  )

// ── stampLastInboxView ─────────────────────────────────────────────

export const stampLastInboxViewFn = createServerFn({ method: 'POST' })
  .validator(stampLastInboxViewDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.stampLastInboxView(
            { responseCutoff: data.responseCutoff },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.stampLastInboxView',
    ),
  )

// ── getInboxQueueCounts ───────────────────────────────────────────

export const getInboxQueueCountsFn = createServerFn({ method: 'GET' })
  .validator(getInboxQueueCountsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'inbox.read',
          propertyId: data?.propertyId,
        })
        const replyQueuesEnabled = await replyStagesAvailable(ctx, data?.propertyId)
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.getInboxQueueCounts(
            { propertyId: data?.propertyId, replyQueuesEnabled },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getInboxQueueCounts',
    ),
  )

// ── getInboxPropertyCounts ────────────────────────────────────────

export const getInboxPropertyCountsFn = createServerFn({ method: 'GET' })
  .validator(getInboxPropertyCountsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // Counted across every visible property, so authorized at organization
        // level — with the list's own reply authority for a reply-stage queue.
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const replyQueuesEnabled = await replyQueuesEnabledFor(ctx, data.queue, undefined)
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.getInboxPropertyCounts(
            { queue: data.queue, replyQueuesEnabled },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getInboxPropertyCounts',
    ),
  )
