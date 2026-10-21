// Review context — the head check's dark comparison.
//
// Google documents page 1 of reviews.list, newest-updated first, as always
// accurate. A head check reads that page and compares each review with
// RepKey's stored copy. In dark mode it persists nothing: it classifies what a
// persisting check WOULD store, so the comparison can be read for a week before
// storing is turned on. Pure: it reads no clock; the caller passes `now`.

import type { GoogleReview } from './types'

/**
 * `REVIEW_HEAD_CHECKS`: `off` runs no head check; `dark` reads and compares and
 * logs what it would store, and changes nothing. A later change adds `persist`.
 */
export type ReviewHeadChecksMode = 'off' | 'dark'

/**
 * A stored copy last fetched this long ago would be refreshed by a persisting
 * check. It matches the lead of the refresh sweep, which re-reads a review five
 * days before its 30-day content TTL.
 */
export const HEAD_LEASE_REFRESH_AFTER_MS = 5 * 24 * 60 * 60 * 1000

export type HeadStoredReply = Readonly<{
  state: 'live' | 'absent'
  providerUpdatedAt: Date | null
}>

/**
 * RepKey's stored copy of one review, as far as the comparison needs it. Found
 * by the review's Google id, which a tombstone (expired or provider-deleted
 * content) no longer carries: a tombstoned review therefore has no copy here
 * and reads as `new`, which is what persisting it again would do.
 */
export type HeadStoredCopy = Readonly<{
  externalId: string
  sourceEpoch: number
  sourceUpdatedAt: Date | null
  lastFetchedAt: Date | null
  /** The reply head. Null when no reply observation was ever recorded. */
  reply: HeadStoredReply | null
}>

/** One review on Google's page, as far as the comparison needs it. */
export type HeadGoogleReview = Pick<
  GoogleReview,
  'externalId' | 'sourceUpdatedAt' | 'replyText' | 'replyUpdatedAt'
> &
  Readonly<{
    /** Google showed a reply whose original text it did not return. */
    replyUnreadable?: boolean
  }>

export type HeadClass = 'new' | 'changed' | 'reply_changed' | 'lease_refresh'

export type HeadComparisonInput = Readonly<{
  now: Date
  /** The Property's current source epoch. */
  sourceEpoch: number
  reviews: readonly HeadGoogleReview[]
  /** Stored copies of (at least) the reviews on the page. */
  copies: readonly HeadStoredCopy[]
  googleTotal: number
  googleAverage: number | null
  /** Reviews RepKey holds live content for in the current epoch. */
  storedLiveCount: number
  storedAverage: number | null
  hasMore: boolean
}>

/** Counts only: nothing here names a review, its reviewer or its text. */
export type HeadComparison = Readonly<{
  listed: number
  newCount: number
  changedCount: number
  replyChangedCount: number
  leaseRefreshCount: number
  /** Distinct reviews a persisting check would store. */
  wouldPersist: number
  googleTotal: number
  storedLiveCount: number
  /** Google's total minus the stored live count. */
  totalDifference: number
  googleAverage: number | null
  storedAverage: number | null
  /** Google's average minus the stored average, to two places. */
  averageDifference: number | null
  hasMore: boolean
}>

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime())

/** Google's updateTime is newer than the stored one (or there is none stored). */
const updatedSince = (google: HeadGoogleReview, copy: HeadStoredCopy): boolean => {
  if (google.sourceUpdatedAt == null) return false
  return (
    copy.sourceUpdatedAt === null ||
    google.sourceUpdatedAt.getTime() > copy.sourceUpdatedAt.getTime()
  )
}

/**
 * The stored copy would be re-persisted: it belongs to an older source epoch
 * (persisting carries it into the current one), or Google's updateTime moved on.
 */
const isChanged = (
  google: HeadGoogleReview,
  copy: HeadStoredCopy,
  sourceEpoch: number,
): boolean => copy.sourceEpoch !== sourceEpoch || updatedSince(google, copy)

/**
 * The reply differs from the stored reply head: present against absent, or
 * both present with another updateTime. An unreadable reply is no difference:
 * persisting records nothing for it, so counting it would count forever.
 */
const isReplyChanged = (google: HeadGoogleReview, copy: HeadStoredCopy): boolean => {
  if (google.replyUnreadable === true) return false
  const googleHasReply = google.replyText !== null
  const storedHasReply = copy.reply?.state === 'live'
  if (googleHasReply !== storedHasReply) return true
  if (!googleHasReply) return false
  return !sameInstant(google.replyUpdatedAt, copy.reply?.providerUpdatedAt ?? null)
}

const needsLeaseRefresh = (copy: HeadStoredCopy, now: Date): boolean =>
  copy.lastFetchedAt === null ||
  copy.lastFetchedAt.getTime() <= now.getTime() - HEAD_LEASE_REFRESH_AFTER_MS

/** What a persisting check would store for one review. */
const classifyHeadReview = (
  google: HeadGoogleReview,
  copy: HeadStoredCopy | undefined,
  input: Pick<HeadComparisonInput, 'now' | 'sourceEpoch'>,
): readonly HeadClass[] => {
  if (copy === undefined) return ['new']
  return [
    ...(isChanged(google, copy, input.sourceEpoch) ? (['changed'] as const) : []),
    ...(isReplyChanged(google, copy) ? (['reply_changed'] as const) : []),
    ...(needsLeaseRefresh(copy, input.now) ? (['lease_refresh'] as const) : []),
  ]
}

const round2 = (value: number): number => Math.round(value * 100) / 100

const countOf = (
  classes: ReadonlyArray<readonly HeadClass[]>,
  wanted: HeadClass,
): number => classes.filter((found) => found.includes(wanted)).length

export const compareHead = (input: HeadComparisonInput): HeadComparison => {
  const byId = new Map(input.copies.map((copy) => [copy.externalId, copy] as const))
  const classes = input.reviews.map((review) =>
    classifyHeadReview(review, byId.get(review.externalId), input),
  )
  return {
    listed: input.reviews.length,
    newCount: countOf(classes, 'new'),
    changedCount: countOf(classes, 'changed'),
    replyChangedCount: countOf(classes, 'reply_changed'),
    leaseRefreshCount: countOf(classes, 'lease_refresh'),
    wouldPersist: classes.filter((found) => found.length > 0).length,
    googleTotal: input.googleTotal,
    storedLiveCount: input.storedLiveCount,
    totalDifference: input.googleTotal - input.storedLiveCount,
    googleAverage: input.googleAverage,
    storedAverage: input.storedAverage,
    averageDifference:
      input.googleAverage === null || input.storedAverage === null
        ? null
        : round2(input.googleAverage - input.storedAverage),
    hasMore: input.hasMore,
  }
}

/**
 * One head job per Property and time bucket, so two looks of one bucket never
 * stack. The bucket is the discovery interval: a Property is looked at no more
 * often than that, and a completed job stays in the queue's retained set long
 * enough to deduplicate against. No colon: BullMQ refuses one in a job id.
 */
export const headCheckJobId = (propertyId: string, now: Date, bucketMs: number): string =>
  `review-head-${propertyId}-${Math.floor(now.getTime() / bucketMs)}`
