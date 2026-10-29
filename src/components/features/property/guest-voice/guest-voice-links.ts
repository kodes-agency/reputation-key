// Where the page's links into the Inbox go. One place, because the Inbox's filter by
// issue (slice 4.4) is still to come and every "See all N reviews" changes with it.

/**
 * The Inbox on the days a figure counted over. It does not yet narrow to the issue:
 * the Inbox has no filter for the issues of the v3 analysis until 4.4 adds one, and
 * this is the one place that then adds the issue to the address.
 */
export function issueReviewsSearch({
  propertyId,
  startLocalDate,
  endLocalDate,
}: Readonly<{
  propertyId: string
  startLocalDate: string
  endLocalDate: string
}>) {
  return { propertyId, since: startLocalDate, until: endLocalDate }
}

/** The Inbox's Urgent reviews of one property, whatever the window. */
export function urgentReviewsSearch(propertyId: string) {
  return { propertyId, attention: 'urgent' } as const
}
