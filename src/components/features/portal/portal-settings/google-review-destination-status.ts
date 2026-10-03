import type { StatusTone } from '#/components/ui/status-badge'
import { formatDate } from '#/lib/format'

export type GoogleReviewDestinationStatus = Readonly<{
  state: 'verified' | 'awaiting_refresh' | 'unavailable'
  retrievedAt: Date | string | null
}>

export type GoogleReviewDestinationPresentation = Readonly<{
  label: 'Ready' | 'Refreshing' | 'Needs connection'
  tone: StatusTone
  description: string
  confirmedAt: string | null
}>

function formatConfirmedAt(value: Date | string | null): string | null {
  return formatDate(value)
}

/**
 * Manager-facing copy for the Property-owned Google review destination.
 * Provider identifiers and the destination URI deliberately stay outside this
 * browser contract: Portal managers only need readiness and freshness.
 */
export function presentGoogleReviewDestination(
  destination: GoogleReviewDestinationStatus,
): GoogleReviewDestinationPresentation {
  if (destination.state === 'verified') {
    return {
      label: 'Ready',
      tone: 'positive',
      description:
        'The Google review action is supplied automatically by this portal’s property.',
      confirmedAt: formatConfirmedAt(destination.retrievedAt),
    }
  }
  if (destination.state === 'awaiting_refresh') {
    return {
      label: 'Refreshing',
      tone: 'neutral',
      description:
        'The property connection is being refreshed. Private ratings and feedback remain available.',
      confirmedAt: formatConfirmedAt(destination.retrievedAt),
    }
  }
  return {
    label: 'Needs connection',
    tone: 'warn',
    description:
      'Guests cannot continue to Google while this property has no verified destination. Publishing is also blocked.',
    confirmedAt: null,
  }
}
