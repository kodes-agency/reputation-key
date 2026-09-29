// Human copy for the notification categories, keyed by category so every
// active surface shares one source. Category ordering and exposure live in the
// domain; only wording lives here.
import type { NotificationCategory } from '#/contexts/feed/application/public-api'

export type NotificationCategoryCopy = Readonly<{
  label: string
  description: string
}>

export const CATEGORY_COPY: Readonly<
  Record<NotificationCategory, NotificationCategoryCopy>
> = {
  mandatory: {
    label: 'Account and security',
    description: 'Required account, security, and service notices.',
  },
  urgent_operational: {
    label: 'Action needed',
    description:
      'Private feedback, escalations, and delivery issues that may need attention.',
  },
  // D4 (docs/design/notifications): off in the app by default.
  arrivals: {
    label: 'New reviews and feedback',
    description:
      'Every new review, and private feedback rated 4 or 5 stars. Lower-rated feedback always reaches you under Action needed.',
  },
  workflow_collaboration: {
    label: 'Workflow and collaboration',
    description: 'Assignments, notes, and reply updates.',
  },
  // `recognition` carries goal results only (ADR 0046, amended 2026-09-22).
  recognition: {
    label: 'Goals',
    description: 'Goal results for your properties.',
  },
}
