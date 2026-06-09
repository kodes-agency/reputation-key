// Inbox context — item detail query server functions

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
import { getInboxItemDetailDto, getInboxNotesDto } from '../application/dto/inbox.dto'

// ── getInboxItemDetail ─────────────────────────────────────────────

export const getInboxItemDetailFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxItemDetailDto)
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
          return await useCases.getInboxItemDetail({
            inboxItemId: inboxItemId(data.inboxItemId),
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
      'inbox.getInboxItemDetail',
    ),
  )

// ── getInboxNotes ──────────────────────────────────────────────────

export const getInboxNotesFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxNotesDto)
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
          return await useCases.getInboxNotes({
            inboxItemId: inboxItemId(data.inboxItemId),
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
      'inbox.getInboxNotes',
    ),
  )
