// Activity context — event handler registration (BullMQ-backed)
// Per-tag handlers subscribe to domain events and enqueue BullMQ jobs.
// Per architecture (ADR 0010): "Handlers map event → job payload, worker calls use case."

import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import { onInboxItemCreated } from './on-inbox-item-created'
import { onInboxStatusChanged } from './on-inbox-status-changed'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import { onInboxItemUnassigned } from './on-inbox-item-unassigned'
import { onInboxNoteAdded } from './on-inbox-note-added'
import { onInboxBulkStatusChanged } from './on-inbox-bulk-status-changed'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'
import { onReplyApproved } from './on-reply-approved'
import { onReplyRejected } from './on-reply-rejected'

export type RegisterActivityHandlersDeps = Readonly<{
  events: EventBus
  queue: Queue
  inboxItemLookup: InboxItemLookupPort
}>

export const registerActivityHandlers = (deps: RegisterActivityHandlersDeps): void => {
  deps.events.on('inbox.inbox_item.created', onInboxItemCreated({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.status_changed',
    onInboxStatusChanged({ queue: deps.queue }),
  )
  deps.events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue: deps.queue }),
  )
  deps.events.on('inbox.inbox_item.assigned', onInboxItemAssigned({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.unassigned',
    onInboxItemUnassigned({ queue: deps.queue }),
  )
  deps.events.on('inbox.inbox_note.added', onInboxNoteAdded({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.bulk_status_changed',
    onInboxBulkStatusChanged({ queue: deps.queue }),
  )
  deps.events.on('review.reply.published', onReplyPublished(deps))
  deps.events.on('review.reply.submitted', onReplySubmitted(deps))
  deps.events.on('review.reply.approved', onReplyApproved(deps))
  deps.events.on('review.reply.rejected', onReplyRejected(deps))
}
