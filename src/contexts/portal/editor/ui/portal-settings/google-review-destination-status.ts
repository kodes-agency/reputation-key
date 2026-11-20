import type { StatusTone } from '#/components/ui/status-badge'
import { formatDate } from '#/lib/format'

export type GoogleReviewDestinationStatus = Readonly<{
  state: 'verified' | 'awaiting_refresh' | 'unavailable'
  retrievedAt: Date | string | null
}>

export type GoogleReviewDestinationPresentation = Readonly<{
  label: 'Ready' | 'On hold' | 'Needs connection'
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
    // Nothing refreshes the link in the background. The Property holds it
    // fenced while archived, and after Google was disconnected from it; this
    // card is told the state only, so it names what lifts the fence in each.
    // The hold closes the Google action alone (an archived Property closes the
    // whole Portal by itself), hence "not affected" rather than "available".
    return {
      label: 'On hold',
      tone: 'neutral',
      description:
        'The property’s Google review link is on hold, so guests cannot continue to Google and publishing is blocked. Private ratings and feedback are not affected. Restoring an archived property that is still linked to Google brings the link back; a property disconnected from Google has to be relinked, and this portal published again.',
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
