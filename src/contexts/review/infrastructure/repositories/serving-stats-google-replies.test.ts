// Reply rate and reply status read Google's reply truth, not only RepKey's
// replies. A reply written directly on Google exists only as a Google reply
// observation (the head says `live`); the legacy `google_sync` mirror row is
// deleted once that observation is recorded. Counting `replies` alone showed
// such a Property at 0% while most of its reviews were answered.
//
// The rules (owner decisions, 2026-10-17):
//  - A review counts as replied when its observation head is `live` or RepKey
//    published a reply to it. Reviews are counted, never replies.
//  - Its reply time is the published reply's `published_at` (RepKey's own
//    reply before a legacy mirror), else the time Google reports for the reply
//    (`provider_updated_at`, its last edit). A review with neither still
//    counts for the rate but not for the average: the observation instant is
//    when RepKey read Google, not when anyone replied.
//  - Same period, tenant and serving-eligibility scope as every serving read.
//
// Real PostgreSQL; the clock is fixed, so eligibility never depends on when
// the suite runs.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createServingStats } from '../serving-stats'

const ORG = organizationId('org-serving-stats-google-replies-0001')
const OTHER_ORG = organizationId('org-serving-stats-google-replies-0002')
const PROP = propertyId('2b200000-0000-4000-8000-000000000001')
const OTHER_PROP = propertyId('2b200000-0000-4000-8000-000000000002')

const NOW = new Date('2026-10-14T12:00:00.000Z')
const PERIOD_START = new Date('2026-10-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-10-31T00:00:00.000Z')
const SERVABLE_UNTIL = new Date('2026-12-01T00:00:00.000Z')
const EXPIRED_AT = new Date('2026-10-10T00:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

const REVIEW = {
  a: '2b200000-0000-4000-8000-0000000000a1',
  b: '2b200000-0000-4000-8000-0000000000a2',
  c: '2b200000-0000-4000-8000-0000000000a3',
  d: '2b200000-0000-4000-8000-0000000000a4',
  other: '2b200000-0000-4000-8000-0000000000b1',
} as const

let pool: Pool
const stats = createServingStats({ db: getDb(), clock: () => NOW })

type ReviewSeed = Readonly<{
  org?: string
  prop?: string
  reviewedAt?: Date
  contentExpiresAt?: Date
}>

async function insertReview(id: string, seed: ReviewSeed = {}): Promise<void> {
  const org = seed.org ?? ORG
  const prop = seed.prop ?? PROP
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, reviewed_at,
       expires_at, content_expires_at, first_fetched_at, last_fetched_at,
       source_epoch, source_revision, analysis_sequence,
       ai_source_byte_length, ai_source_digest
     ) VALUES ($1, $2, $3, 'google', $4, $5, 'Guest', 4, 'A good stay', $6,
               $7, $7, $8, $8, 0, 1, 0, 1, repeat('0', 64))`,
    [
      id,
      org,
      prop,
      `ext-${id}`,
      GOOGLE_LOCATION_PRIMARY_RESOURCE,
      seed.reviewedAt ?? new Date('2026-10-05T00:00:00.000Z'),
      seed.contentExpiresAt ?? SERVABLE_UNTIL,
      NOW,
    ],
  )
  // The material revision every reply observation binds to.
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, rating, content_state
     ) VALUES ($1, 1, $2, $3, 0, 'legacy-unverified-v0', 4, 'active')`,
    [id, org, prop],
  )
}

type ReplySeed = Readonly<{
  org?: string
  source?: 'internal' | 'google_sync'
  status?: 'draft' | 'pending_approval' | 'published'
  publishedAt?: Date | null
}>

/** A row in `replies`: RepKey's own reply, or a legacy Google mirror. */
async function insertReply(reviewId: string, seed: ReplySeed = {}): Promise<void> {
  const source = seed.source ?? 'internal'
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, authorship, published_at
     ) VALUES ($1, $2, $3, 'Thank you for staying', $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      reviewId,
      seed.org ?? ORG,
      seed.status ?? 'published',
      source,
      source === 'internal' ? 'human' : null,
      seed.publishedAt ?? null,
    ],
  )
}

type GoogleReplySeed = Readonly<{
  org?: string
  prop?: string
  state: 'live' | 'absent'
  providerUpdatedAt?: Date | null
  observedAt?: Date
  /** The observation's own content clock, set once when it was recorded. */
  contentExpiresAt?: Date
}>

/** What Google shows for a review now: one observation and the head on it. */
async function insertGoogleReply(reviewId: string, seed: GoogleReplySeed): Promise<void> {
  const org = seed.org ?? ORG
  const prop = seed.prop ?? PROP
  const live = seed.state === 'live'
  const key = reviewId.replaceAll('-', '').repeat(2)
  const observedAt = seed.observedAt ?? NOW
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO google_reply_observations (
       organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance,
       normalized_text, normalization_version, normalized_digest,
       provider_updated_at, observed_at, content_expires_at
     ) VALUES ($1, $2, $3, 1, $4, $4, 0, 1, 1, $5, $6, $7, 'provider_snapshot', $8,
               $9, 'google-reply-v1', $10, $11, $12, $13)
     RETURNING id`,
    [
      org,
      prop,
      reviewId,
      key,
      seed.state,
      live ? 'added' : 'deleted',
      live ? 'external_current_live' : 'absent',
      live ? 'external_or_unknown' : 'none',
      live ? 'Thank you for staying' : null,
      live ? 'c'.repeat(64) : null,
      seed.providerUpdatedAt ?? null,
      observedAt,
      seed.contentExpiresAt ?? SERVABLE_UNTIL,
    ],
  )
  await pool.query(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id,
       observation_revision, source_epoch, material_review_revision, state,
       provenance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, 0, 1, $5, $6, $7, $7)`,
    [
      reviewId,
      org,
      prop,
      inserted.rows[0]?.id,
      seed.state,
      live ? 'external_or_unknown' : 'none',
      observedAt,
    ],
  )
}

async function clean(): Promise<void> {
  const orgs = [ORG, OTHER_ORG]
  await pool.query(
    'DELETE FROM google_reply_observation_heads WHERE organization_id = ANY($1)',
    [orgs],
  )
  await pool.query(
    'DELETE FROM google_reply_observations WHERE organization_id = ANY($1)',
    [orgs],
  )
  await pool.query('DELETE FROM replies WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM reviews WHERE organization_id = ANY($1)', [orgs])
}

const replyPerformance = (org = ORG, prop = PROP) =>
  stats.getReplyPerformance(org, prop, PERIOD_START, PERIOD_END)

const hoursAfter = (instant: Date, hours: number) =>
  new Date(instant.getTime() + hours * HOUR_MS)

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const [org, prop, slug] of [
    [ORG, PROP, 'serving-google-replies'],
    [OTHER_ORG, OTHER_PROP, 'serving-google-replies-other'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Serving Google Replies Org', $2, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org, slug],
    )
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Serving Google Replies Property', $3, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [prop, org, slug],
    )
  }
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await pool.end()
})

describe('getReplyPerformance counts a review as replied when Google shows a reply', () => {
  it('counts a review whose reply was written directly on Google', async () => {
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertGoogleReply(REVIEW.a, {
      state: 'live',
      providerUpdatedAt: hoursAfter(reviewedAt, 5),
    })
    await insertReview(REVIEW.b)

    expect(await replyPerformance()).toEqual({
      totalReviews: 2,
      repliedCount: 1,
      avgReplyHours: 5,
    })
  })

  it('counts a review RepKey published a reply to', async () => {
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertReply(REVIEW.a, { publishedAt: hoursAfter(reviewedAt, 3) })
    await insertReview(REVIEW.b)

    expect(await replyPerformance()).toEqual({
      totalReviews: 2,
      repliedCount: 1,
      avgReplyHours: 3,
    })
  })

  it('counts a review once however many replies say it was answered', async () => {
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertReply(REVIEW.a, { publishedAt: hoursAfter(reviewedAt, 6) })
    await insertReply(REVIEW.a, {
      source: 'google_sync',
      publishedAt: hoursAfter(reviewedAt, 2),
    })
    await insertGoogleReply(REVIEW.a, {
      state: 'live',
      providerUpdatedAt: hoursAfter(reviewedAt, 9),
    })

    // Each source has its own time, so the 6 h shows which one was read:
    // RepKey's own reply, not the earlier mirror (2) or Google's time (9).
    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 1,
      avgReplyHours: 6,
    })
  })

  it('counts a review whose only reply is a legacy Google mirror, at its time', async () => {
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertReply(REVIEW.a, {
      source: 'google_sync',
      publishedAt: hoursAfter(reviewedAt, 8),
    })
    await insertReview(REVIEW.b)

    expect(await replyPerformance()).toEqual({
      totalReviews: 2,
      repliedCount: 1,
      avgReplyHours: 8,
    })
  })

  it('still counts a Google reply whose observation content clock has lapsed', async () => {
    // The observation's clock is set when it is recorded, and a later fetch
    // that finds the same reply restates the head without moving it. The
    // review's clock moves on every fetch, so a review still servable here
    // was fetched within the cache window and its head says what Google
    // showed then. Only state and Google's time are read, never reply text.
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertGoogleReply(REVIEW.a, {
      state: 'live',
      providerUpdatedAt: hoursAfter(reviewedAt, 5),
      contentExpiresAt: EXPIRED_AT,
    })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 1,
      avgReplyHours: 5,
    })
    const recent = await stats.getRecentReviews(ORG, PROP, 10)
    expect(recent.map((row) => row.replyStatus)).toEqual(['published'])
  })

  it('does not count a review whose Google reply is gone', async () => {
    await insertReview(REVIEW.a)
    await insertGoogleReply(REVIEW.a, { state: 'absent' })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 0,
      avgReplyHours: null,
    })
  })

  it('does not count a draft RepKey has not published', async () => {
    await insertReview(REVIEW.a)
    await insertReply(REVIEW.a, { status: 'pending_approval' })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 0,
      avgReplyHours: null,
    })
  })

  it('leaves out a review RepKey may no longer serve, with its Google reply', async () => {
    await insertReview(REVIEW.a)
    await insertReview(REVIEW.b, { contentExpiresAt: EXPIRED_AT })
    await insertGoogleReply(REVIEW.b, {
      state: 'live',
      providerUpdatedAt: new Date('2026-10-06T00:00:00.000Z'),
    })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 0,
      avgReplyHours: null,
    })
  })

  it('leaves out a review written outside the period, with its Google reply', async () => {
    await insertReview(REVIEW.a)
    await insertReview(REVIEW.b, { reviewedAt: new Date('2026-09-20T00:00:00.000Z') })
    await insertGoogleReply(REVIEW.b, {
      state: 'live',
      providerUpdatedAt: new Date('2026-09-21T00:00:00.000Z'),
    })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 0,
      avgReplyHours: null,
    })
  })

  it("never counts another Organization's replied review", async () => {
    await insertReview(REVIEW.a)
    await insertReview(REVIEW.other, { org: OTHER_ORG, prop: OTHER_PROP })
    await insertReply(REVIEW.other, {
      org: OTHER_ORG,
      publishedAt: new Date('2026-10-05T01:00:00.000Z'),
    })
    await insertGoogleReply(REVIEW.other, {
      org: OTHER_ORG,
      prop: OTHER_PROP,
      state: 'live',
      providerUpdatedAt: new Date('2026-10-05T01:00:00.000Z'),
    })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 0,
      avgReplyHours: null,
    })
    // The same fixture counts for its own tenant, so the zero above is the
    // tenant filter and not a fixture that never counts.
    expect(await replyPerformance(OTHER_ORG, OTHER_PROP)).toEqual({
      totalReviews: 1,
      repliedCount: 1,
      avgReplyHours: 1,
    })
    // Another tenant's id with this Property's id reads nothing at all.
    expect(await replyPerformance(OTHER_ORG, PROP)).toEqual({
      totalReviews: 0,
      repliedCount: 0,
      avgReplyHours: null,
    })
  })
})

describe('getReplyPerformance reply time', () => {
  it("uses RepKey's publish time, else Google's reply time, and never the time RepKey read Google", async () => {
    const atA = new Date('2026-10-02T00:00:00.000Z')
    const atB = new Date('2026-10-03T00:00:00.000Z')
    const atC = new Date('2026-10-04T00:00:00.000Z')
    // A: RepKey published after 10 h; Google reports a later edit (72 h).
    await insertReview(REVIEW.a, { reviewedAt: atA })
    await insertReply(REVIEW.a, { publishedAt: hoursAfter(atA, 10) })
    await insertGoogleReply(REVIEW.a, {
      state: 'live',
      providerUpdatedAt: hoursAfter(atA, 72),
    })
    // B: written on Google after 4 h; RepKey first read it 9 days later.
    await insertReview(REVIEW.b, { reviewedAt: atB })
    await insertGoogleReply(REVIEW.b, {
      state: 'live',
      providerUpdatedAt: hoursAfter(atB, 4),
      observedAt: hoursAfter(atB, 9 * 24),
    })
    // C: Google shows a reply but gave no time for it.
    await insertReview(REVIEW.c, { reviewedAt: atC })
    await insertGoogleReply(REVIEW.c, {
      state: 'live',
      providerUpdatedAt: null,
      observedAt: hoursAfter(atC, 2),
    })
    // D: no reply.
    await insertReview(REVIEW.d)

    // (10 + 4) / 2 = 7. Google's time for A would make it 38; C's read time
    // would make it 5; B's read time would make it 79.
    expect(await replyPerformance()).toEqual({
      totalReviews: 4,
      repliedCount: 3,
      avgReplyHours: 7,
    })
  })

  it("times RepKey's own reply over a later legacy Google mirror", async () => {
    const reviewedAt = new Date('2026-10-05T00:00:00.000Z')
    await insertReview(REVIEW.a, { reviewedAt })
    await insertReply(REVIEW.a, { publishedAt: hoursAfter(reviewedAt, 2) })
    await insertReply(REVIEW.a, {
      source: 'google_sync',
      publishedAt: hoursAfter(reviewedAt, 20),
    })

    // The latest publish time of either row would make it 20.
    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 1,
      avgReplyHours: 2,
    })
  })

  it('has no average when no replied review has a reply time', async () => {
    await insertReview(REVIEW.a)
    await insertGoogleReply(REVIEW.a, { state: 'live', providerUpdatedAt: null })

    expect(await replyPerformance()).toEqual({
      totalReviews: 1,
      repliedCount: 1,
      avgReplyHours: null,
    })
  })
})

describe('getRecentReviews reply status', () => {
  const statusOf = async (id: string) => {
    const rows = await stats.getRecentReviews(ORG, PROP, 10)
    return rows.find((row) => row.id === id)?.replyStatus
  }

  it('is published when Google shows a reply RepKey never sent', async () => {
    await insertReview(REVIEW.a)
    await insertGoogleReply(REVIEW.a, { state: 'live', providerUpdatedAt: null })

    expect(await statusOf(REVIEW.a)).toBe('published')
  })

  it('is published when Google shows a reply and a RepKey draft is open', async () => {
    await insertReview(REVIEW.a)
    await insertGoogleReply(REVIEW.a, { state: 'live', providerUpdatedAt: null })
    await insertReply(REVIEW.a, { status: 'draft' })

    expect(await statusOf(REVIEW.a)).toBe('published')
  })

  it('is a draft when only a RepKey draft exists', async () => {
    await insertReview(REVIEW.a)
    await insertReply(REVIEW.a, { status: 'draft' })

    expect(await statusOf(REVIEW.a)).toBe('draft')
  })

  it('is none when the Google reply is gone and RepKey sent nothing', async () => {
    await insertReview(REVIEW.a)
    await insertGoogleReply(REVIEW.a, { state: 'absent' })

    expect(await statusOf(REVIEW.a)).toBe('none')
  })
})
