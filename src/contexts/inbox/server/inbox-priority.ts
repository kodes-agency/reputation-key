// Inbox context — manager priority server function (ADR 0071).
//
// Gated like Escalate (`inbox.write`, then the use case's source and Property
// scope; the control adds `inbox.manage`). A stale revision comes back as the
// conflict result the client retries once; a colleague's change to the
// priority itself is a 409 `priority_changed`, which it does not retry.

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  createServerFn,
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
  toInboxRevisionConflictResult,
} from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { setInboxItemPriorityDto } from '../application/dto/inbox.dto'

export const setInboxItemPriorityFn = createServerFn({ method: 'POST' })
  .validator(setInboxItemPriorityDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.setInboxItemPriority(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
              expectedPriority: data.expectedPriority,
              priority: data.priority,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e)) {
            const conflict = toInboxRevisionConflictResult(e)
            if (conflict) return conflict
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          }
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.setInboxItemPriority',
    ),
  )
