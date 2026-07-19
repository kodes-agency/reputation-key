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
import { getLogger } from '#/shared/observability/logger'

// ── getInboxItems ──────────────────────────────────────────────────

export const getInboxItemsFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxItemsDto)
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
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxItems(
            {
              filters: {
                propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
                status: data.status,
                isEscalated: data.isEscalated,
                sourceType: data.sourceType,
                platform: data.platform,
                ratingMin: data.ratingMin,
                ratingMax: data.ratingMax,
                sourceDateFrom: data.sourceDateFrom,
                sourceDateTo: data.sourceDateTo,
                q: data.q,
              },
              cursor: data.cursor
                ? (() => {
                    try {
                      const parsed = JSON.parse(
                        Buffer.from(data.cursor, 'base64').toString('utf-8'),
                      )
                      // F134: Validate cursor shape — must have sourceDate (string) and id (string)
                      if (
                        !parsed ||
                        typeof parsed.sourceDate !== 'string' ||
                        typeof parsed.id !== 'string'
                      ) {
                        getLogger().warn(
                          { cursor: data.cursor },
                          'inbox: malformed cursor shape, treating as first page',
                        )
                        return undefined
                      }
                      return parsed
                    } catch {
                      getLogger().warn(
                        { cursor: data.cursor },
                        'inbox: malformed cursor encoding, treating as first page',
                      )
                      return undefined
                    }
                  })()
                : undefined,
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
  .inputValidator(getLastVisitCountDto)
  .handler(
    tracedHandler(
      async () => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { useCases } = getContainer()
        try {
          return await useCases.getLastVisitCount({}, ctx)
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
  .inputValidator(stampLastInboxViewDto)
  .handler(
    tracedHandler(
      async () => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { useCases } = getContainer()
        try {
          return await useCases.stampLastInboxView({}, ctx)
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
  .inputValidator(getInboxFolderCountsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxFolderCounts(
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
