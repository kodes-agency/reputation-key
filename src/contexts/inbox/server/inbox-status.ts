// Inbox context — status mutation server functions

import {
  createServerFn,
  canForContext,
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
} from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { updateStatusDto, bulkUpdateStatusDto } from '../application/dto/inbox.dto'

// ── updateInboxStatus ──────────────────────────────────────────────

export const updateInboxStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'inbox.write')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox update permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.updateInboxStatus(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              newStatus: data.status,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.updateInboxStatus',
    ),
  )

// ── bulkUpdateInboxStatus ──────────────────────────────────────────

export const bulkUpdateInboxStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkUpdateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'inbox.write')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox update permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.bulkUpdateInboxStatus(
            {
              inboxItemIds: data.inboxItemIds.map((id) => inboxItemId(id)),
              newStatus: data.status,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.bulkUpdateInboxStatus',
    ),
  )
