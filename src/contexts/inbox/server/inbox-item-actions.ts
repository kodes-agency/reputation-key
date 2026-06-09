// Inbox context — item action server functions (assign, note)

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
  toUserId,
} from './inbox-shared'
import { assignInboxItemDto, addInboxNoteDto } from '../application/dto/inbox.dto'

// ── assignInboxItem ────────────────────────────────────────────────

export const assignInboxItemFn = createServerFn({ method: 'POST' })
  .inputValidator(assignInboxItemDto)
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
          return await useCases.assignInboxItem({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            assignedToUserId: data.assignedToUserId
              ? toUserId(data.assignedToUserId)
              : null,
            role: ctx.role,
            userId: ctx.userId,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.assignInboxItem',
    ),
  )

// ── addInboxNote ───────────────────────────────────────────────────

export const addInboxNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(addInboxNoteDto)
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
          return await useCases.addInboxNote({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            text: data.text,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.addInboxNote',
    ),
  )
