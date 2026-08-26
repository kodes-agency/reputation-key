// Human copy for the notification categories, keyed by category so every
// active surface shares one source. Retained categories still need fallback
// copy so historical rows remain readable, even when they are absent from
// settings and filters. Category ordering and exposure live in the domain;
// only wording lives here.
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
    label: 'Past awards',
    shortLabel: 'Past awards',
    description: 'Earlier award updates retained in notification history.',
  },
}
