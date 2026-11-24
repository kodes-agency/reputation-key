// Inbox context — manager priority server function (ADR 0071).
//
// Gated like Escalate (`inbox.write`, then the use case's source and Property
// scope; the control adds `inbox.manage`). A stale revision comes back as the
// conflict result the client retries once; a colleague's change to the
// priority itself is a 409 `priority_changed`, which it does not retry.

import { createServerFn } from '@tanstack/react-start'
import { inboxItemId } from '#/shared/domain/ids'
import { runInboxRevisionCommand } from './inbox-command'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { setInboxItemPriorityDto } from '../inbox/contracts'

export const setInboxItemPriorityFn = createServerFn({ method: 'POST' })
  .validator(setInboxItemPriorityDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.setInboxItemPriority(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
              expectedPriority: data.expectedPriority,
              priority: data.priority,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.setInboxItemPriority',
    ),
  )
