// A persisting head check against real PostgreSQL: it stores only what differs,
// stores Google's numbers as a fact that proves no listing, and stores nothing
// where it must not.
//
// The fake is the Google side only (the newest page). The head check, the
// observation writer, the repositories, the reply observation store, the first
// sighting ledger and the outbox are the real ones.

import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  DAY_MS,
  EPOCH,
  ORG,
  OTHER_ORG,
  PROPERTY,
  clock,
  count,
  db,
  factRows,
  freshHeadCheck,
  headCheck,
  insertFact,
  observationsOf,
  observeEarlier,
  providerReview,
  reviewRows,
  subjectKeyService,
  useHeadPersistDatabase,
} from './review-head-persist.test-fixtures'

useHeadPersistDatabase()

describe('a persisting head check (real PostgreSQL)', () => {
  it('writes only what differs: a new review and an edited one, not the unchanged one', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const same = providerReview('same')
    const edited = providerReview('edited')
    await observeEarlier(same, earlier)
    await observeEarlier(edited, earlier)
    await insertFact({ count: 2, average: 4 })
    clock.at = new Date()
    const sameBefore = await observationsOf(same.externalId)

    const { result } = await headCheck(
      [
        providerReview('new'),
        same,
        {
          ...edited,
          text: 'Edited on Google',
          sourceUpdatedAt: new Date(clock.at.getTime() - 60_000),
        },
      ],
      { total: 3, average: 4 },
    )

    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'stored', storedNew: 1, storedOther: 1, failed: 0 },
    })
    expect(await reviewRows()).toEqual([
      { external_id: 'head-persist-edited', text: 'Edited on Google' },
      { external_id: 'head-persist-new', text: 'Review new' },
      { external_id: 'head-persist-same', text: 'Review same' },
    ])
    expect(await observationsOf(same.externalId)).toBe(sameBefore)
    expect(await observationsOf('head-persist-new')).toBe(1)
  })

  it('refreshes the lease of a review Google restated at an unmoved updateTime without a new revision', async () => {
    // Stored six days ago: past the five-day lease, so the head check stores it
    // again although updateTime never moved. Google has since reworded it.
    const earlier = new Date(Date.now() - 6 * DAY_MS)
    const original = providerReview('restated')
    await observeEarlier(original, earlier)
    await insertFact({ count: 1, average: 4 })
    clock.at = new Date()

    const { result } = await headCheck(
      [{ ...original, rating: 3, text: 'Reworded by Google, same updateTime' }],
      { total: 1, average: 4 },
    )

    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedOther: 1, failed: 0 },
    })
    expect(await reviewRows()).toEqual([
      {
        external_id: 'head-persist-restated',
        text: 'Reworded by Google, same updateTime',
      },
    ])
    const history = await db.execute(sql`
      SELECT o.material_revision, o.comparison_result
      FROM review_source_observations o
      JOIN review_source_contents c ON c.review_id = o.review_id AND c.organization_id = o.organization_id
      WHERE c.organization_id = ${ORG} AND c.external_id = ${original.externalId}
      ORDER BY o.observation_sequence
    `)
    expect(history.rows).toEqual([
      { material_revision: '1', comparison_result: 'initial_material_revision' },
      // A restatement is stored as the shadow match: the revision is kept.
      { material_revision: '1', comparison_result: 'normalization_shadow_match' },
    ])
    expect(
      await count(sql`
        SELECT count(*)::int AS count FROM material_review_revisions
        WHERE organization_id = ${ORG}
      `),
    ).toBe(1)
  })

  it('writes nothing when every review on the page matches its stored copy', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const same = providerReview('same')
    await observeEarlier(same, earlier)
    await insertFact({ count: 1, average: 4 })
    clock.at = new Date()
    const before = await observationsOf(same.externalId)

    const { result } = await headCheck([same], { total: 1, average: 4 })

    expect(result).toMatchObject({
      persistence: {
        outcome: 'stored',
        storedNew: 0,
        storedOther: 0,
        factWritten: false,
      },
    })
    expect(await observationsOf(same.externalId)).toBe(before)
    expect(await factRows()).toHaveLength(1)
  })

  it('records a review nobody held as first seen via head, as live work', async () => {
    await freshHeadCheck()

    const sightings = await db.execute(sql`
      SELECT first_seen_via FROM review_first_sightings WHERE organization_id = ${ORG}
    `)
    expect(sightings.rows).toEqual([{ first_seen_via: 'head' }])
    // Live work, not onboarding history: the new Review is measured for its Response Target.
    const eligibility = await db.execute(sql`
      SELECT m.response_target_eligibility FROM material_review_revisions m
      JOIN reviews r ON r.id = m.review_id AND r.organization_id = m.organization_id
      WHERE r.organization_id = ${ORG}
    `)
    expect(eligibility.rows).toEqual([{ response_target_eligibility: 'measured' }])
  })

  it('stamps the discovery ladder when the page held a review nobody had', async () => {
    await freshHeadCheck()

    const state = await db.execute(sql`
      SELECT last_new_review_at FROM review_sync_state WHERE property_id = ${PROPERTY}
    `)
    expect(
      Number.isNaN(new Date(String(state.rows[0]?.last_new_review_at)).getTime()),
    ).toBe(false)
  })

  it('stores Google’s numbers as a fact that proves no listing, and publishes the verified event', async () => {
    await insertFact({ count: 5, average: 4 })

    const { result } = await headCheck([], { total: 7, average: 4.3 })

    expect(result).toMatchObject({ persistence: { factWritten: true } })
    const facts = await factRows()
    expect(facts).toHaveLength(2)
    expect(facts[1]).toMatchObject({
      review_count: 7,
      average_rating: 4.3,
      listing_complete: false,
    })
    const events = await db.execute(sql`
      SELECT payload FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'review.google_reputation_snapshot.verified'
    `)
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0]?.payload).toMatchObject({
      reviewCount: 7,
      averageRating: 4.3,
      sourceEpoch: EPOCH,
    })
  })

  it('writes no fact while Google’s numbers equal the newest fact and it is recent', async () => {
    await insertFact({
      count: 7,
      average: 4.3,
      evaluatedAt: new Date(Date.now() - 600_000),
    })

    const { result } = await headCheck([], { total: 7, average: 4.3 })

    expect(result).toMatchObject({ persistence: { factWritten: false } })
    expect(await factRows()).toHaveLength(1)
  })

  it('writes a heartbeat fact when the newest fact is six hours old', async () => {
    await insertFact({
      count: 7,
      average: 4.3,
      evaluatedAt: new Date(Date.now() - 7 * 3_600_000),
    })

    await headCheck([], { total: 7, average: 4.3 })

    expect(await factRows()).toHaveLength(2)
  })

  it('maps each review it stores to its provider subject, seen by no run, and moves only the revision of a listed one', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const listed = providerReview('listed')
    const stored = await observeEarlier(listed, earlier)
    const runId = crypto.randomUUID()
    const deriver = await subjectKeyService.acquireDeriver()
    const [subject] = deriver.deriveCandidates({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      resourceName: listed.reviewName,
    })
    await db.execute(sql`
      INSERT INTO review_provider_snapshot_runs
        (id, organization_id, property_id, source_epoch, state, phase, started_at,
         expires_at, terminal_at, record_expires_at)
      VALUES (${runId}, ${ORG}, ${PROPERTY}, ${EPOCH}, 'completed', 'terminal', ${earlier},
        ${earlier}, ${earlier}, ${earlier}::timestamptz + interval '30 days')
    `)
    await db.execute(sql`
      INSERT INTO review_provider_subjects
        (organization_id, property_id, source_epoch, key_version, locator_hmac,
         verifier_hmac, review_id, last_source_revision, state, last_observed_at,
         last_seen_snapshot_run_id)
      VALUES (${ORG}, ${PROPERTY}, ${EPOCH}, ${subject.keyVersion},
        ${Buffer.from(subject.locatorHmac)}, ${Buffer.from(subject.verifierHmac)},
        ${stored.reviewId}, ${stored.sourceRevision}, 'linked', ${earlier}, ${runId})
    `)
    await insertFact({ count: 1, average: 4 })
    clock.at = new Date()

    const { result } = await headCheck(
      [
        providerReview('head-only'),
        {
          ...listed,
          text: 'Edited on Google',
          sourceUpdatedAt: new Date(clock.at.getTime() - 60_000),
        },
      ],
      { total: 2, average: 4 },
    )

    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedNew: 1, storedOther: 1, failed: 0 },
    })
    const subjects = await db.execute(sql`
      SELECT c.external_id, s.state, s.last_source_revision,
             s.last_seen_snapshot_run_id, s.first_missing_snapshot_run_id
      FROM review_provider_subjects s
      JOIN review_source_contents c ON c.review_id = s.review_id
        AND c.organization_id = s.organization_id
      WHERE s.organization_id = ${ORG}
      ORDER BY c.external_id
    `)
    expect(subjects.rows).toEqual([
      {
        external_id: 'head-persist-head-only',
        state: 'linked',
        last_source_revision: '1',
        last_seen_snapshot_run_id: null,
        first_missing_snapshot_run_id: null,
      },
      // The listing's mapping keeps the run that saw it; only its revision
      // follows the edit, so the removal step still matches the Review.
      {
        external_id: 'head-persist-listed',
        state: 'linked',
        last_source_revision: String(stored.sourceRevision + 1),
        last_seen_snapshot_run_id: runId,
        first_missing_snapshot_run_id: null,
      },
    ])
  })

  it('records the row as mode head, with what was stored', async () => {
    await freshHeadCheck()

    const runs = await db.execute(sql`
      SELECT mode, created_count, updated_count, failed_count, result
      FROM review_sync_runs WHERE property_id = ${PROPERTY}
    `)
    expect(runs.rows).toHaveLength(1)
    expect(runs.rows[0]).toMatchObject({
      mode: 'head',
      created_count: 1,
      updated_count: 0,
      failed_count: 0,
    })
    expect(JSON.parse(String(runs.rows[0]?.result))).toMatchObject({
      persisted: 'stored',
      storedNew: 1,
      factWritten: true,
    })
  })
})

describe('a persisting head check overtaken by a newer read (real PostgreSQL)', () => {
  it('passes silently, instead of failing, when a newer sync read already moved the reply head', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const answered = providerReview('answered', {
      replyText: 'Thanks for your review',
      replyUpdatedAt: new Date(earlier.getTime() + 1_000),
    })
    await observeEarlier(answered, earlier)
    await insertFact({ count: 1, average: 4 })
    clock.at = new Date()

    // Generation 1 is older than the reply head the earlier read left behind.
    const { result, warn } = await headCheck(
      [
        {
          ...answered,
          replyText: 'Thanks, we hope to see you again',
          replyUpdatedAt: new Date(clock.at.getTime() - 5_000),
        },
      ],
      { total: 1, average: 4, generation: 1 },
    )

    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedOther: 1, failed: 0 },
    })
    expect(warn).not.toHaveBeenCalled()
    const head = await db.execute(sql`
      SELECT o.normalized_text FROM google_reply_observation_heads h
      JOIN google_reply_observations o ON o.id = h.observation_id
      WHERE h.organization_id = ${ORG}
    `)
    expect(head.rows).toEqual([{ normalized_text: 'Thanks for your review' }])
  })
})

describe('a persisting head check stores nothing where it must not (real PostgreSQL)', () => {
  it('stores nothing before the epoch has a completed listing, and writes no fact', async () => {
    await insertFact({ count: 0, average: null, listingComplete: false })

    const { result } = await headCheck([providerReview('fresh')], {
      total: 1,
      average: 4,
    })

    expect(result).toMatchObject({
      status: 'compared',
      comparison: { newCount: 1 },
      persistence: { outcome: 'skipped_no_listing', storedNew: 0, factWritten: false },
    })
    expect(await reviewRows()).toEqual([])
    expect(await factRows()).toHaveLength(1)
  })

  it('stores nothing while a snapshot run of the Property is active, but still compares and counts', async () => {
    await insertFact({ count: 0, average: null })
    await db.execute(sql`
      INSERT INTO review_provider_snapshot_runs
        (id, organization_id, property_id, source_epoch, state, phase, started_at, expires_at)
      VALUES (${crypto.randomUUID()}, ${ORG}, ${PROPERTY}, ${EPOCH}, 'confirming', 'confirmation',
        now() - interval '2 minutes', now() + interval '1 hour')
    `)

    const { result } = await headCheck([providerReview('fresh')], {
      total: 1,
      average: 4,
    })

    expect(result).toMatchObject({
      comparison: { listed: 1, newCount: 1, wouldPersist: 1 },
      persistence: {
        outcome: 'skipped_snapshot_active',
        storedNew: 0,
        factWritten: false,
      },
    })
    expect(await reviewRows()).toEqual([])
    expect(await factRows()).toHaveLength(1)
    const runs = await db.execute(sql`
      SELECT mode, result FROM review_sync_runs WHERE property_id = ${PROPERTY}
    `)
    expect(runs.rows[0]?.mode).toBe('head')
    expect(JSON.parse(String(runs.rows[0]?.result))).toMatchObject({
      new: 1,
      wouldPersist: 1,
      persisted: 'skipped_snapshot_active',
    })
  })

  it('stores nothing in dark mode and writes the head_dark row as before', async () => {
    const { result } = await freshHeadCheck({ mode: 'dark' })

    expect(result).toMatchObject({ persistence: null })
    expect(await reviewRows()).toEqual([])
    expect(await factRows()).toHaveLength(1)
    const runs = await db.execute(sql`
      SELECT mode FROM review_sync_runs WHERE property_id = ${PROPERTY}
    `)
    expect(runs.rows).toEqual([{ mode: 'head_dark' }])
  })

  it('does not touch another Property’s reviews or facts', async () => {
    await freshHeadCheck()

    const other = await count(sql`
      SELECT count(*)::int AS count FROM reviews WHERE organization_id = ${OTHER_ORG}
    `)
    expect(other).toBe(0)
  })
})
