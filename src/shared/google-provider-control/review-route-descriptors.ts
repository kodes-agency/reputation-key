// The Review routes' input shapes. They live beside
// the catalogue, not in it, so the catalogue file does not grow with every
// Review route (it is on the file-length ratchet).

/**
 * `reviews.list` ordering a caller may ask for. Google documents page 1 of a
 * list sorted `updateTime desc` as always accurate, which is what the head read
 * relies on. It is one literal, not a free string, so a descriptor can never
 * carry an arbitrary query value.
 */
export const REVIEW_LIST_NEWEST_UPDATED_FIRST = 'updateTime desc' as const

export type ReviewRouteDescriptor =
  | Readonly<{
      routeKey: 'reviews.list'
      accessToken: string
      locationName: string
      pageToken?: string
      orderBy?: typeof REVIEW_LIST_NEWEST_UPDATED_FIRST
    }>
  | Readonly<{
      routeKey: 'reviews.get'
      accessToken: string
      reviewName: string
    }>
  | Readonly<{
      routeKey: 'reviews.reply'
      accessToken: string
      reviewName: string
      comment: string
    }>
