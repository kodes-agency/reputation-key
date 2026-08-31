export type GoogleReviewDestinationStatus = Readonly<{
  state: 'verified' | 'awaiting_refresh' | 'unavailable'
  retrievedAt: Date | string | null
}>

export type GoogleReviewDestinationPresentation = Readonly<{
  label: 'Ready' | 'Refreshing' | 'Needs connection'
  badgeVariant: 'default' | 'secondary' | 'outline'
  description: string
  confirmedAt: string | null
}>

function formatConfirmedAt(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date)
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
      badgeVariant: 'default',
      description:
        'The Google review action is supplied automatically by this portal’s property.',
      confirmedAt: formatConfirmedAt(destination.retrievedAt),
    }
  }
  if (destination.state === 'awaiting_refresh') {
    return {
      label: 'Refreshing',
      badgeVariant: 'secondary',
      description:
        'The property connection is being refreshed. Private ratings and feedback remain available.',
      confirmedAt: formatConfirmedAt(destination.retrievedAt),
    }
  }
  return {
    label: 'Needs connection',
    badgeVariant: 'outline',
    description:
      'Connect or refresh Google for this property before publishing the portal.',
    confirmedAt: null,
  }
}
