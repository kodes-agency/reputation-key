import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { sha256Hex } from '#/shared/domain/sha256'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'
import type { Review } from '../domain/review-types'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createEligibleGoogleReplyReads } from '../reviews/eligible-reads.server'
import { eraseReviewSourceContent } from '#/contexts/reputation/public-api'
import { createGoogleReplyObservationStore } from './google-reply-observation-store.server'
import type { RecordGoogleReplyObservation } from './google-reply-observation-store.port.server'
import {
  NOW,
  ORG,
  REVIEW_A,
  installObservationFixture,
  makeReview,
  observationInput,
  pool,
} from './google-reply-observation.test-fixtures'

installObservationFixture()

// A read that finds the reply the head already holds records no row, but it is
// a successful Google fetch of that reply, and the reply's 30-day content clock
// counts from the last such fetch (ADR 0031). The Inbox refuses a reply whose
// clock has passed, so the clock has to follow the reads.
describe.sequential("a re-read of Google's reply keeps its content clock alive", () => {
  const HOUR_MS = 60 * 60 * 1000
  const DAY_MS = 24 * HOUR_MS
  const REPLY_TEXT = 'Thank you for staying with us.'
  const NO_REPLY = { observedText: null, providerUpdatedAt: null }

  type StoredRow = Readonly<Record<string, unknown>>

  const seedReview = (): Promise<Review> =>
    createReviewRepository(getDb(), () => NOW, undefined, replyScopeEffects).upsert(
      makeReview(REVIEW_A, 'external-reply-clock'),
    )

  const after = (ms: number): Date => new Date(NOW.getTime() + ms)

  /** One read of Google made at `at`, with the 30-day clock that fetch gives it.
   * A new `key` makes it a second read, not a replay of the first. */
  const readAt = (
    review: Review,
    at: Date,
    key: string,
    overrides: Record<string, unknown> = {},
  ): RecordGoogleReplyObservation =>
    observationInput(review, {
      observationKey: sha256Hex(`reply-clock:${key}`),
      observedText: REPLY_TEXT,
      observedAt: at,
      contentExpiresAt: contentExpiresAtFromFetch(at),
      ...overrides,
    })

  async function oneRow(
    query: string,
    params: readonly unknown[] = [REVIEW_A],
  ): Promise<StoredRow> {
    const row = (await pool.query<StoredRow>(query, [...params])).rows[0]
    if (!row) throw new Error('The query found no row')
    return row
  }

  /** The row the head points at, whole, to compare before and after a read. */
  const headObservation = () =>
    oneRow(
      `SELECT observation.*
         FROM google_reply_observation_heads AS head
         JOIN google_reply_observations AS observation
           ON observation.id = head.observation_id
        WHERE head.review_id = $1`,
    )

  const headRow = () =>
    oneRow('SELECT * FROM google_reply_observation_heads WHERE review_id = $1')

  const observationAt = (revision: number) =>
    oneRow(
      'SELECT * FROM google_reply_observations WHERE review_id = $1 AND observation_revision = $2',
      [REVIEW_A, revision],
    )

  async function count(query: string, param: string): Promise<number> {
    const result = await pool.query<{ n: number }>(query, [param])
    return result.rows[0]?.n ?? 0
  }

  const observationRows = () =>
    count(
      'SELECT count(*)::int AS n FROM google_reply_observations WHERE review_id = $1',
      REVIEW_A,
    )

  const facts = () =>
    count('SELECT count(*)::int AS n FROM outbox_events WHERE organization_id = $1', ORG)

  const erase = (review: Review): Promise<boolean> =>
    getDb().transaction((tx) =>
      eraseReviewSourceContent(
        tx,
        {
          reviewId: review.id,
          organizationId: review.organizationId,
          propertyId: review.propertyId,
          sourceEpoch: review.sourceEpoch,
          expectedSourceRevision: review.sourceRevision,
          state: 'source_expired',
        },
        replyScopeEffects,
      ),
    )

  const inboxReadsAt = (now: Date) =>
    createEligibleGoogleReplyReads({
      googleReplyObservations: createGoogleReplyObservationStore(getDb()),
      clock: () => now,
    })

  it('moves the clock and updated_at forward to the later read', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'first'))
    const laterRead = after(6 * HOUR_MS)

    const reread = await store.record(readAt(review, laterRead, 'second'))

    expect(reread).toMatchObject({ duplicate: true, observationRevision: 1 })
    expect(await headObservation()).toMatchObject({
      content_expires_at: contentExpiresAtFromFetch(laterRead),
      updated_at: laterRead,
      observed_at: NOW,
    })
  })

  it('keeps a reply readable past thirty days for as long as Google keeps showing it', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'day 0'))

    for (const day of [10, 20, 30, 40]) {
      await store.record(readAt(review, after(day * DAY_MS), `day ${day}`))
    }

    await expect(
      inboxReadsAt(after(45 * DAY_MS)).getCurrentGoogleReplyByReviewId(REVIEW_A, ORG),
    ).resolves.toMatchObject({ text: REPLY_TEXT, observationRevision: 1 })
  })

  it('makes a reply whose clock has already lapsed readable again on the next read that finds it', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'lapsing'))
    const lapsedAt = after(40 * DAY_MS)
    const inbox = inboxReadsAt(lapsedAt)
    await expect(inbox.getCurrentGoogleReplyByReviewId(REVIEW_A, ORG)).resolves.toBeNull()

    await store.record(readAt(review, lapsedAt, 'healing'))

    await expect(
      inbox.getCurrentGoogleReplyByReviewId(REVIEW_A, ORG),
    ).resolves.toMatchObject({ text: REPLY_TEXT, observationRevision: 1 })
  })

  it('never moves the clock backwards: a read whose expiry is older changes nothing', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, after(DAY_MS), 'newest'))
    const stored = await headObservation()

    const reread = await store.record(readAt(review, NOW, 'a read a day older'))

    expect(reread).toMatchObject({ duplicate: true, observationRevision: 1 })
    expect(await headObservation()).toEqual(stored)
  })

  it('writes no row, revision or fact, and changes nothing else on the row or the head', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'first'))
    const rowBefore = await headObservation()
    const headBefore = await headRow()
    const factsBefore = await facts()
    const laterRead = after(6 * HOUR_MS)

    // Google's own time for the reply moved too; the stored one stays.
    await store.record(
      readAt(review, laterRead, 'second', {
        providerUpdatedAt: new Date(laterRead.getTime() - HOUR_MS),
      }),
    )

    expect(await headObservation()).toEqual({
      ...rowBefore,
      content_expires_at: contentExpiresAtFromFetch(laterRead),
      updated_at: laterRead,
    })
    expect(await headRow()).toEqual(headBefore)
    expect(await observationRows()).toBe(1)
    expect(await facts()).toBe(factsBefore)
  })

  it('moves only the current row: the copy of an earlier reply keeps its own clock', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'first', { observedText: 'The first reply' }))
    await store.record(
      readAt(review, after(HOUR_MS), 'edit', { observedText: 'The edited reply' }),
    )
    const supersededCopy = await observationAt(1)
    const laterRead = after(7 * HOUR_MS)

    await store.record(
      readAt(review, laterRead, 'restated', { observedText: 'The edited reply' }),
    )

    expect(await observationAt(1)).toEqual(supersededCopy)
    expect(await observationAt(2)).toMatchObject({
      content_expires_at: contentExpiresAtFromFetch(laterRead),
    })
  })

  it('leaves a head that records no reply on the clock it has', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'no reply first', NO_REPLY))
    const stored = await headObservation()

    await store.record(readAt(review, after(6 * HOUR_MS), 'no reply second', NO_REPLY))

    expect(await headObservation()).toEqual(stored)
  })

  it('does not renew an erased head: it stays erased, with the clock the erasure left', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'erased first', NO_REPLY))
    expect(await erase(review)).toBe(true)
    const erased = await headObservation()
    expect(erased).toMatchObject({ content_state: 'source_expired' })

    await store.record(readAt(review, after(6 * HOUR_MS), 'erased second', NO_REPLY))

    expect(await headObservation()).toEqual(erased)
  })

  it('records a reply that shows again after erasure as new content, and leaves the erased row alone', async () => {
    const review = await seedReview()
    const store = createGoogleReplyObservationStore(getDb())
    await store.record(readAt(review, NOW, 'live before erasure'))
    expect(await erase(review)).toBe(true)
    const erased = await observationAt(1)
    const laterRead = after(6 * HOUR_MS)

    const again = await store.record(readAt(review, laterRead, 'live after erasure'))

    expect(again).toMatchObject({ duplicate: false, observationRevision: 2 })
    expect(await observationAt(1)).toEqual(erased)
    expect(await headObservation()).toMatchObject({
      observation_revision: '2',
      content_state: 'active',
      content_expires_at: contentExpiresAtFromFetch(laterRead),
    })
  })
})
