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
      'Urgent reviews, private feedback without a rating, escalations, and delivery issues that may need attention.',
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
    description: 'Assignments, notes, reply updates and sites waiting for approval.',
  },
  // One row per goal (ADR 0046, amended 2026-10-17). `recognition` keeps its
  // stored name and carries only the Google rating goal's changes.
  recognition: {
    label: 'Google rating goal',
    description: 'Changes to your Google rating goal.',
  },
  portal_goals: {
    label: 'Portal goals',
    description: 'Monthly results of your portal goals.',
  },
  // Opt-in on both channels (v3 contract decision 11).
  guest_voice: {
    label: 'Guest voice summary',
    description:
      'Mondays at 8:00: what to fix first, what guests love and what changed. Nothing in a quiet week; a roundup on the first Monday of the month.',
  },
}

/**
 * A category's label inside a sentence ("Mute portal goals for this
 * property"): lower case, but Google stays a name.
 */
export const categoryInSentence = (category: NotificationCategory): string =>
  category === 'recognition'
    ? CATEGORY_COPY[category].label
    : CATEGORY_COPY[category].label.toLowerCase()
