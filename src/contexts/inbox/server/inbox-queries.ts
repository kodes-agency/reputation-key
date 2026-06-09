// Inbox context — query server functions (list, counts)

import {
  createServerFn,
  tracedHandler,
  headersFromContext,
  resolveTenantContext,
  throwContextError,
  catchUntagged,
  can,
  getContainer,
  isInboxError,
  inboxErrorStatus,
  propertyId,
} from './inbox-shared'
import {
  getInboxItemsDto,
  getNewCountDto,
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
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxItems({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
            filters: {
              propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
              status: data.status,
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
          })
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

// ── getNewCount ────────────────────────────────────────────────────

export const getNewCountFn = createServerFn({ method: 'GET' })
  .inputValidator(getNewCountDto)
  .handler(
    tracedHandler(
      async ({ data: _data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.getNewCount({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'inbox.getNewCount',
    ),
  )

// ── getInboxFolderCounts ──────────────────────────────────────────

export const getInboxFolderCountsFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxFolderCountsDto)
  .handler(
    tracedHandler(
      async ({ data: _data }) => {
        void _data
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxFolderCounts({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
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
