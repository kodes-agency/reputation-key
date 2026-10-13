// `reviewId` is the idempotency key the browser makes for one review act
// (`crypto.randomUUID()`), and it is written into three durable facts and their
// `source_aggregate_id`; a superseded id is the event id of one of those facts.
// The request is held to that shape, so no fact carries text of a caller's
// choosing and size.

import { describe, expect, it } from 'vitest'
import { completeContentReviewInputSchema } from './complete-content-review.dto'

const REVIEW_ID = '7d0a6c1e-3f52-4b8a-9c1d-2e4f6a8b0c1d'
const EVENT_IDS = {
  contentReviewSourceEventId: '11111111-1111-4111-8111-111111111111',
  configurationSourceEventId: '22222222-2222-4222-8222-222222222222',
  destinationRatioSourceEventId: '33333333-3333-4333-8333-333333333333',
} as const

const first = { portalId: 'portal-p1', reviewId: REVIEW_ID, revision: 1 }

/** The paths the schema refuses, or an empty list when it accepts. */
const refusedPaths = (input: unknown): ReadonlyArray<string> =>
  (completeContentReviewInputSchema.safeParse(input).error?.issues ?? []).map((issue) =>
    issue.path.join('.'),
  )

describe('completeContentReview input', () => {
  it('accepts the review the browser sends, and a correction naming three event ids', () => {
    expect(completeContentReviewInputSchema.parse(first)).toEqual(first)
    const correction = { ...first, revision: 2, supersedes: EVENT_IDS }
    expect(completeContentReviewInputSchema.parse(correction)).toEqual(correction)
    expect(refusedPaths({ ...first, supersedes: null })).toEqual([])
  })

  it.each([
    ['free text', 'the lobby review, second attempt'],
    ['several hundred kilobytes of text', 'x'.repeat(300_000)],
    ['a UUID with something after it', `${REVIEW_ID} and more`],
    ['an empty string', ''],
  ])('refuses a reviewId that is %s', (_label, reviewId) => {
    expect(refusedPaths({ ...first, reviewId })).toEqual(['reviewId'])
  })

  it.each(Object.keys(EVENT_IDS))('refuses a %s that is not an event id', (field) => {
    const supersedes = { ...EVENT_IDS, [field]: 'y'.repeat(10_000) }
    expect(refusedPaths({ ...first, revision: 2, supersedes })).toEqual([
      `supersedes.${field}`,
    ])
  })
})
