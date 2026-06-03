// Activity context — event-to-activity mapping
// Pure domain function: converts DomainEvent → MappedActivity | null
// Does NOT resolve user names — that's the job handler's responsibility.
// Lives in application/ because it imports DomainEvent from shared/events (shared-events boundary).

import type { DomainEvent } from '#/shared/events/events'
import type { ActivityAction, ResourceType, ActivityPayload } from '../domain/types'

export type MappedActivity = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: string | null
  organizationId: string
  payload: ActivityPayload
}>

export const eventToActivity = (event: DomainEvent): MappedActivity | null => {
  switch (event._tag) {
    case 'inbox.inbox_item.created':
      return {
        action: 'created',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: event.propertyId as string,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'inbox_item',
          from: null,
          to: null,
          detail: event.sourceType,
        },
      }
    case 'inbox.inbox_item.status_changed':
      return {
        action: 'changed',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'status',
          from: event.oldStatus,
          to: event.newStatus,
          detail: null,
        },
      }
    case 'inbox.inbox_item.escalated':
      return {
        action: 'escalated',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'inbox_item',
          from: event.oldStatus,
          to: 'escalated',
          detail: null,
        },
      }
    case 'inbox.inbox_item.assigned':
      return {
        action: 'assigned',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'inbox_item',
          from: null,
          to: event.assignedTo as string,
          detail: null,
        },
      }
    case 'inbox.inbox_item.unassigned':
      return {
        action: 'unassigned',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'inbox_item',
          from: event.previousAssignee as string,
          to: null,
          detail: null,
        },
      }
    case 'inbox.inbox_note.added':
      return {
        action: 'added',
        resourceType: 'note',
        resourceId: event.noteId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'note',
          from: null,
          to: null,
          detail: event.text.length > 100 ? event.text.slice(0, 100) + '...' : event.text,
        },
      }
    case 'inbox.inbox_item.bulk_status_changed':
      return {
        action: 'changed',
        resourceType: 'inbox_item',
        resourceId: event.inboxItemId as string,
        propertyId: null,
        organizationId: event.organizationId as string,
        payload: {
          subject: 'status',
          from: event.oldStatus,
          to: event.newStatus,
          detail: null,
          bulkId: event.bulkId,
        },
      }
    case 'review.reply.published':
      return {
        action: 'published',
        resourceType: 'reply',
        resourceId: event.replyId as string,
        propertyId: event.propertyId as string,
        organizationId: event.organizationId as string,
        payload: { subject: 'reply', from: null, to: null, detail: null },
      }
    case 'review.reply.submitted':
      return {
        action: 'submitted',
        resourceType: 'reply',
        resourceId: event.replyId as string,
        propertyId: event.propertyId as string,
        organizationId: event.organizationId as string,
        payload: { subject: 'reply', from: null, to: null, detail: null },
      }
    case 'review.reply.approved':
      return {
        action: 'approved',
        resourceType: 'reply',
        resourceId: event.replyId as string,
        propertyId: event.propertyId as string,
        organizationId: event.organizationId as string,
        payload: { subject: 'reply', from: null, to: null, detail: null },
      }
    case 'review.reply.rejected':
      return {
        action: 'rejected',
        resourceType: 'reply',
        resourceId: event.replyId as string,
        propertyId: event.propertyId as string,
        organizationId: event.organizationId as string,
        payload: { subject: 'reply', from: null, to: null, detail: event.reason },
      }
    default:
      // All other events (review.created, metric.recorded, etc.) are excluded
      return null
  }
}
