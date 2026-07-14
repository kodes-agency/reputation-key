// Activity context — event handler registration (BullMQ-backed)
// Per-tag handlers subscribe to domain events and enqueue BullMQ jobs.
// Per architecture (ADR 0010): "Handlers map event → job payload, worker calls use case."

import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import { onInboxItemCreated } from './on-inbox-item-created'
import { onInboxStatusChanged } from './on-inbox-status-changed'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import { onInboxItemEscalationResolved } from './on-inbox-item-escalation-resolved'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import { onInboxItemUnassigned } from './on-inbox-item-unassigned'
import { onInboxNoteAdded } from './on-inbox-note-added'
import { onInboxBulkStatusChanged } from './on-inbox-bulk-status-changed'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'
import { onReplyApproved } from './on-reply-approved'
import { onReplyRejected } from './on-reply-rejected'
import { onTeamCreated } from './on-team-created'
import { onTeamUpdated } from './on-team-updated'
import { onTeamDeleted } from './on-team-deleted'
import { onStaffAssigned } from './on-staff-assigned'
import { onStaffUnassigned } from './on-staff-unassigned'
import { onMemberInvited } from './on-member-invited'
import { onInvitationAccepted } from './on-invitation-accepted'
import { onInvitationCanceled } from './on-invitation-canceled'
import { onMemberRemoved } from './on-member-removed'
import { onMemberRoleChanged } from './on-member-role-changed'
import { onGoogleAccountConnected } from './on-google-account-connected'
import { onGoogleAccountDisconnected } from './on-google-account-disconnected'

export type RegisterActivityHandlersDeps = Readonly<{
  events: EventBus
  queue: Queue
  inboxItemLookup: InboxItemLookupPort
}>

export const registerActivityHandlers = (deps: RegisterActivityHandlersDeps): void => {
  // ── Inbox events ──
  deps.events.on('inbox.inbox_item.created', onInboxItemCreated({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.status_changed',
    onInboxStatusChanged({ queue: deps.queue }),
  )
  deps.events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue: deps.queue }),
  )
  deps.events.on(
    'inbox.inbox_item.escalation_resolved',
    onInboxItemEscalationResolved({ queue: deps.queue }),
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

  // ── Review events ──
  deps.events.on('review.reply.published', onReplyPublished(deps))
  deps.events.on('review.reply.submitted', onReplySubmitted(deps))
  deps.events.on('review.reply.approved', onReplyApproved(deps))
  deps.events.on('review.reply.rejected', onReplyRejected(deps))

  // ── Team events (user-management audit) ──
  deps.events.on('team.created', onTeamCreated({ queue: deps.queue }))
  deps.events.on('team.updated', onTeamUpdated({ queue: deps.queue }))
  deps.events.on('team.deleted', onTeamDeleted({ queue: deps.queue }))

  // ── Staff events (user-management audit) ──
  deps.events.on('staff.assigned', onStaffAssigned({ queue: deps.queue }))
  deps.events.on('staff.unassigned', onStaffUnassigned({ queue: deps.queue }))

  // ── Identity events (user-management audit) ──
  deps.events.on('identity.member.invited', onMemberInvited({ queue: deps.queue }))
  deps.events.on(
    'identity.invitation.accepted',
    onInvitationAccepted({ queue: deps.queue }),
  )
  deps.events.on(
    'identity.invitation.canceled',
    onInvitationCanceled({ queue: deps.queue }),
  )
  deps.events.on('identity.member.removed', onMemberRemoved({ queue: deps.queue }))
  deps.events.on(
    'identity.member.role_changed',
    onMemberRoleChanged({ queue: deps.queue }),
  )

  // ── Integration events (user-management audit) ──
  deps.events.on(
    'integration.google_account.connected',
    onGoogleAccountConnected({ queue: deps.queue }),
  )
  deps.events.on(
    'integration.google_account.disconnected',
    onGoogleAccountDisconnected({ queue: deps.queue }),
  )
}
