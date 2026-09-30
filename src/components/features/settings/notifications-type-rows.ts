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
      'Private feedback without a rating, escalations, and delivery issues that may need attention.',
  },
  // ADR 0046, amended 2026-09-30: "how low" is the person's, per channel.
  low_ratings: {
    label: 'Low ratings',
    description:
      "Reviews and private feedback at or below the rating you choose. A Google review's stars show when you open it.",
  },
  // D4 (docs/design/notifications): off in the app by default.
  arrivals: {
    label: 'New reviews and feedback',
    description:
      'Every other new review and rated private feedback, above your Low ratings choice.',
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
