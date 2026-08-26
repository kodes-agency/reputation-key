// Human copy for the notification categories, keyed by category so every
// surface shares one source: the settings page iterates
// NOTIFICATION_CATEGORIES, the feed's filter tabs iterate
// GOVERNING_NOTIFICATION_CATEGORIES, and both look the label up here. The
// category ORDER and the set of categories live in the domain
// (notification-delivery-policy.ts); only the wording lives here.
import type { NotificationCategory } from '#/contexts/notification/application/public-api'

export type NotificationCategoryCopy = Readonly<{
  label: string
  /** Compact form for filter tabs, where horizontal space is ~8 characters. */
  shortLabel: string
  description: string
}>

export const CATEGORY_COPY: Readonly<
  Record<NotificationCategory, NotificationCategoryCopy>
> = {
  mandatory: {
    label: 'Account and safety',
    shortLabel: 'Account',
    description: 'Required account, security, and service notices.',
  },
  urgent_operational: {
    label: 'Action needed',
    shortLabel: 'Action',
    description:
      'Private feedback, escalations, and delivery issues that may need attention.',
  },
  workflow_collaboration: {
    label: 'Workflow and collaboration',
    shortLabel: 'Workflow',
    description: 'Reviews, assignments, notes, and reply updates.',
  },
  recognition: {
    label: 'Recognition',
    shortLabel: 'Recognition',
    description: 'Recognition updates for activated properties.',
  },
}
