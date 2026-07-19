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
import { onReplyPublicationCancelled } from './on-reply-publication-cancelled'
import { onReplyUpdated } from './on-reply-updated'
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
import { onOrganizationCreated } from './on-organization-created'
import { onPropertyUpdated } from './on-property-updated'
import { onPropertyDeleted } from './on-property-deleted'
import { onGoogleConnectionVisibilityChanged } from './on-google-connection-visibility-changed'
import { onPropertyImportCompleted } from './on-property-import-completed'

export type RegisterActivityHandlersDeps = Readonly<{
  events: EventBus
  queue: Queue
  inboxItemLookup: InboxItemLookupPort
}>

export const registerActivityHandlers = (deps: RegisterActivityHandlersDeps): void => {
  // ── Inbox events ──
  deps.events.on('inbox.inbox_item.created', onInboxItemCreated({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on(
    'inbox.inbox_item.status_changed',
    onInboxStatusChanged({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'inbox.inbox_item.escalation_resolved',
    onInboxItemEscalationResolved({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'inbox.inbox_item.assigned',
    onInboxItemAssigned({ queue: deps.queue }),
    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'inbox.inbox_item.unassigned',
    onInboxItemUnassigned({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on('inbox.inbox_note.added', onInboxNoteAdded({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on(
    'inbox.inbox_item.bulk_status_changed',
    onInboxBulkStatusChanged({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )

  // ── Review events ──
  deps.events.on('review.reply.published', onReplyPublished(deps), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on(
    'review.reply.publication_cancelled',
    onReplyPublicationCancelled(deps),
    { consumer: 'activity.event-handlers' },
  )
  deps.events.on('review.reply.updated', onReplyUpdated(deps), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('review.reply.submitted', onReplySubmitted(deps), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('review.reply.approved', onReplyApproved(deps), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('review.reply.rejected', onReplyRejected(deps), {
    consumer: 'activity.event-handlers',
  })

  // ── Team events (user-management audit) ──
  deps.events.on('team.created', onTeamCreated({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('team.updated', onTeamUpdated({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('team.deleted', onTeamDeleted({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })

  // ── Staff events (user-management audit) ──
  deps.events.on('staff.assigned', onStaffAssigned({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('staff.unassigned', onStaffUnassigned({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })

  // ── Identity events (user-management audit) ──
  deps.events.on(
    'identity.organization.created',
    onOrganizationCreated({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on('identity.member.invited', onMemberInvited({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on(
    'identity.invitation.accepted',
    onInvitationAccepted({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'identity.invitation.canceled',
    onInvitationCanceled({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on('identity.member.removed', onMemberRemoved({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on(
    'identity.member.role_changed',
    onMemberRoleChanged({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )

  // ── Integration events (user-management audit) ──
  deps.events.on(
    'integration.google_account.connected',
    onGoogleAccountConnected({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'integration.google_account.disconnected',
    onGoogleAccountDisconnected({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'integration.google_connection.visibility_changed',
    onGoogleConnectionVisibilityChanged({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )
  deps.events.on(
    'integration.property_import.completed',
    onPropertyImportCompleted({ queue: deps.queue }),

    { consumer: 'activity.event-handlers' },
  )

  // ── Property events (BQC-3.9 orphan consume: audit) ──
  deps.events.on('property.updated', onPropertyUpdated({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
  deps.events.on('property.deleted', onPropertyDeleted({ queue: deps.queue }), {
    consumer: 'activity.event-handlers',
  })
}
