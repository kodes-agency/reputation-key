// Inbox context — query server functions (list, counts)

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
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
  getInboxFolderCountsDto,
} from '../application/dto/inbox.dto'
import { decodeInboxCursor } from '../application/inbox-cursor'

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
        const { inboxPublicApi, logger } = getContainer()
        try {
          const cursor = data.cursor ? decodeInboxCursor(data.cursor) : null
          if (data.cursor && cursor === null) {
            // Do not echo the untrusted cursor into logs.
            logger.warn('inbox: malformed cursor, treating as first page')
          }
          return await inboxPublicApi.getInboxItems(
            {
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
                category: data.category
                  ? Array.isArray(data.category)
                    ? data.category
                    : [data.category]
                  : undefined,
                sourceDateFrom: data.sourceDateFrom,
                sourceDateTo: data.sourceDateTo,
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

// ── getInboxFolderCounts ──────────────────────────────────────────

export const getInboxFolderCountsFn = createServerFn({ method: 'GET' })
  .validator(getInboxFolderCountsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.getInboxFolderCounts(
            { propertyId: data?.propertyId },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getInboxFolderCounts',
    ),
  )
