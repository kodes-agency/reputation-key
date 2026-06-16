// Inbox context — item action server functions (assign, note)

import {
  createServerFn,
  can,
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
  toUserId,
} from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
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
