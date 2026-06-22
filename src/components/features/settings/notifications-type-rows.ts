import type { NotificationType } from '#/contexts/notification/application/public-api'

// Display metadata for every notification type the backend recognises.
// Keep in sync with NOTIFICATION_TYPES in notification/domain/types.ts (single source).
export const TYPE_ROWS: ReadonlyArray<{
  type: NotificationType
  label: string
  description: string
}> = [
  {
    type: 'review.created',
    label: 'New reviews',
    description: 'A new review is published for a property.',
  },
  {
    type: 'feedback.created',
    label: 'New feedback',
    description: 'A guest submits new feedback.',
  },
  {
    type: 'reply.pending_approval',
    label: 'Reply pending approval',
    description: 'A reply is awaiting approval.',
  },
  {
    type: 'reply.approved',
    label: 'Reply approved',
    description: 'A reply you submitted is approved.',
  },
  {
    type: 'reply.rejected',
    label: 'Reply rejected',
    description: 'A reply you submitted is rejected.',
  },
  {
    type: 'reply.published',
    label: 'Reply published',
    description: 'A reply is published publicly.',
  },
  {
    type: 'reply.publish_failed',
    label: 'Reply publish failed',
    description: 'A reply failed to publish.',
  },
  {
    type: 'inbox.escalated',
    label: 'Escalated items',
    description: 'An inbox item is escalated.',
  },
  {
    type: 'inbox.assigned',
    label: 'Assignments',
    description: 'An inbox item is assigned to you.',
  },
  {
    type: 'inbox_note.added',
    label: 'Notes',
    description: 'A note is added to an inbox item.',
  },
  {
    type: 'goal.completed',
    label: 'Goals completed',
    description: 'A goal is completed.',
  },
  { type: 'badge.awarded', label: 'Badges awarded', description: 'A badge is awarded.' },
]
