// Inbox context — item action server functions (assign, note)

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  createServerFn,
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
import {
  assignInboxItemDto,
  bulkAssignInboxItemsDto,
  addInboxNoteDto,
} from '../application/dto/inbox.dto'

// ── assignInboxItem ────────────────────────────────────────────────

export const assignInboxItemFn = createServerFn({ method: 'POST' })
  .validator(assignInboxItemDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.assignInboxItem(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              assignedToUserId: data.assignedToUserId
                ? toUserId(data.assignedToUserId)
                : null,
              expectedCommandRevision: data.expectedCommandRevision,
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
      'inbox.assignInboxItem',
    ),
  )

export const bulkAssignInboxItemsFn = createServerFn({ method: 'POST' })
  .validator(bulkAssignInboxItemsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.bulkAssignInboxItems(
            {
              items: data.items.map((item) => ({
                inboxItemId: inboxItemId(item.inboxItemId),
                expectedCommandRevision: item.expectedCommandRevision,
              })),
              assignedToUserId: data.assignedToUserId
                ? toUserId(data.assignedToUserId)
                : null,
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
      'inbox.bulkAssignInboxItems',
    ),
  )

// ── addInboxNote ───────────────────────────────────────────────────

export const addInboxNoteFn = createServerFn({ method: 'POST' })
  .validator(addInboxNoteDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.addInboxNote(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              text: data.text,
              expectedCommandRevision: data.expectedCommandRevision,
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
      'inbox.addInboxNote',
    ),
  )
