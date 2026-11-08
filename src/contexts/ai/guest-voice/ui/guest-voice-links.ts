// Where the page's links into the Inbox go. One place, because every "See all N
// reviews" changes with the Inbox's filters.

/**
 * The Inbox on the reviews a figure counted: the days it counted over, and the one issue
 * it is about, in the way it counted it (a problem's reviews are the ones that complain
 * of it, praise's the ones that praise it).
 */
export function issueReviewsSearch({
  propertyId,
  startLocalDate,
  endLocalDate,
  issueId,
  sense = 'complaint',
}: Readonly<{
  propertyId: string
  startLocalDate: string
  endLocalDate: string
  issueId: string
  sense?: 'complaint' | 'praise'
}>) {
  return {
    propertyId,
    since: startLocalDate,
    until: endLocalDate,
    issue: issueId,
    polarity: sense === 'complaint' ? ('negative' as const) : ('positive' as const),
  }
}

/** The Inbox's Urgent reviews of one property, whatever the window. */
export function urgentReviewsSearch(propertyId: string) {
  return { propertyId, attention: 'urgent' } as const
}
