// Inbox context — status mutation server functions

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
  inboxItemId,
} from './inbox-shared'
import { updateStatusDto, bulkUpdateStatusDto } from '../application/dto/inbox.dto'

// ── updateInboxStatus ──────────────────────────────────────────────

export const updateInboxStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'inbox.write')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox update permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.updateInboxStatus({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            newStatus: data.status,
            userId: ctx.userId,
            role: ctx.role,
          })
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
        if (!can(ctx.role, 'inbox.write')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox update permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.bulkUpdateInboxStatus({
            inboxItemIds: data.inboxItemIds.map((id) => inboxItemId(id)),
            organizationId: ctx.organizationId,
            newStatus: data.status,
            userId: ctx.userId,
            role: ctx.role,
          })
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
