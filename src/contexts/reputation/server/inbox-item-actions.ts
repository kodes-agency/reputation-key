// Inbox context — item action server functions (assign, note)

import { createServerFn } from '@tanstack/react-start'
import { inboxItemId, userId as toUserId } from '#/shared/domain/ids'
import { runInboxCommand, runInboxRevisionCommand } from './inbox-command'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  assignInboxItemDto,
  bulkAssignInboxItemsDto,
  addInboxNoteDto,
} from '../inbox/contracts'

// ── assignInboxItem ────────────────────────────────────────────────

export const assignInboxItemFn = createServerFn({ method: 'POST' })
  .validator(assignInboxItemDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.assignInboxItem(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              assignedToUserId: data.assignedToUserId
                ? toUserId(data.assignedToUserId)
                : null,
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.assignInboxItem',
    ),
  )

export const bulkAssignInboxItemsFn = createServerFn({ method: 'POST' })
  .validator(bulkAssignInboxItemsDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.write', (inbox, ctx) =>
          inbox.bulkAssignInboxItems(
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
          ),
        ),
      'POST',
      'inbox.bulkAssignInboxItems',
    ),
  )

// ── addInboxNote ───────────────────────────────────────────────────

export const addInboxNoteFn = createServerFn({ method: 'POST' })
  .validator(addInboxNoteDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.addInboxNote(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              text: data.text,
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.addInboxNote',
    ),
  )
