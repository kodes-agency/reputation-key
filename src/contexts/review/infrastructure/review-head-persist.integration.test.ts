// A persisting head check against real PostgreSQL: it stores only what differs,
// stores Google's numbers as a fact that proves no listing, and stores nothing
// where it must not.
//
// The fake is the Google side only (the newest page). The head check, the
// observation writer, the repositories, the reply observation store, the first
// sighting ledger and the outbox are the real ones.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deriveReviewProviderSubject } from '#/shared/review-provider-subject-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { inboxItemStatusChanged } from '#/contexts/inbox/domain/events'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { createAtomicInboxCommandStore } from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createReplyObservationAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-observation-authority.adapter'
import { createReviewReplyObservationAuthority } from './reply-observation-authority'
import type {
  GoogleReviewHeadResult,
  GoogleReviewRead,
} from '../application/ports/google-review-api.port'
import type { ReviewProviderSubjectKeyService } from '../application/provider-subject-keyring'
import { createReviewProviderObservationWriter } from '../application/use-cases/sync-reviews'
import { createRunReviewHeadCheck } from '../application/use-cases/run-review-head-check'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewHeadCheckRepository } from './repositories/review-head-check.repository'
import { createReviewProviderSnapshotRepository } from './repositories/review-provider-snapshot.repository'
import { createReviewRepository } from './repositories/review.repository'
import { createReviewSyncActivityRecorder } from './repositories/review-sync-activity.repository'

const ORG = organizationId('review-head-persist-org-a')
const OTHER_ORG = organizationId('review-head-persist-org-b')
const CONNECTION = googleConnectionId('b6f1e100-0000-4000-8000-00000000c001')
const OTHER_CONNECTION = googleConnectionId('b6f1e100-0000-4000-8000-00000000c002')
const PROPERTY = propertyId('b6f1e100-0000-4000-8000-00000000a001')
const OTHER_PROPERTY = propertyId('b6f1e100-0000-4000-8000-00000000a002')
const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
const INBOX_ITEM = inboxItemId('b6f1e100-0000-4000-8000-00000000b001')
const EPOCH = 0
const DAY_MS = 24 * 60 * 60 * 1000
const TEST_KEY_VERSION = 'head-persist-test-v1'
const TEST_KEY = new Uint8Array(32).fill(7)

const db = getDb()
let clockAt = new Date()
let activeKeyVersion = TEST_KEY_VERSION
let insertedTestKey = false
let tick = 0

const snapshotRepository = createReviewProviderSnapshotRepository(db, () =>
  crypto.randomUUID(),
)
const writer = createReviewProviderObservationWriter({
  reviewRepo: createReviewRepository(db, () => clockAt),
  clock: () => clockAt,
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(db, () => clockAt),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: snapshotRepository,
})

const subjectKeyService: ReviewProviderSubjectKeyService = {
  acquireDeriver: async () => ({
    activeVersion: activeKeyVersion,
    retiringVersion: null,
    inventoryGeneration: 1,
    deriveCandidates: (scope) => [
      deriveReviewProviderSubject({
        ...scope,
        keyVersion: activeKeyVersion,
        key: TEST_KEY,
      }),
    ],
  }),
  stageTrustedNext: vi.fn(async () => undefined),
  activateTrustedNext: vi.fn(async () => undefined),
  removeRetiring: vi.fn(async () => undefined),
}

function providerReview(
  slug: string,
  over: Partial<GoogleReviewRead> = {},
): GoogleReviewRead {
  const published = new Date(clockAt.getTime() - 3 * DAY_MS)
  return {
    reviewName: `${LOCATION}/reviews/${slug}`,
    externalId: `head-persist-${slug}`,
    externalLocationId: LOCATION,
    reviewerName: `Guest ${slug}`,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: `Review ${slug}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: published,
    sourceCreatedAt: published,
    sourceUpdatedAt: published,
    replyText: null,
    replyUpdatedAt: null,
    ...over,
  }
}

/** A read made by a full snapshot page or any other read before the head check. */
async function observeEarlier(review: GoogleReviewRead, at: Date) {
  clockAt = at
  const deriver = await subjectKeyService.acquireDeriver()
  return writer.persist({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: EPOCH,
    observationOrigin: 'ongoing',
    firstSeenVia: 'snapshot',
    observationKey: crypto.randomUUID().replaceAll('-', '').repeat(2),
    replyReadGeneration: await writer.allocateReplyReadGeneration(),
    review,
    subjects: deriver.deriveCandidates({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      resourceName: review.reviewName,
    }),
  })
}

async function insertFact(
  over: Readonly<{
    count?: number
    average?: number | null
    listingComplete?: boolean
    evaluatedAt?: Date
    observedAt?: Date | null
  }> = {},
) {
  await db.execute(sql`
    INSERT INTO review_google_reputation_snapshot_facts
      (run_id, event_id, organization_id, property_id, source_epoch, review_count,
       average_rating, evaluated_at, numbers_observed_at, listing_complete)
    VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORG}, ${PROPERTY}, ${EPOCH},
      ${over.count ?? 2}, ${over.average === undefined ? 4 : over.average},
      ${over.evaluatedAt ?? new Date(Date.now() - 3_600_000)},
      ${over.observedAt === undefined ? null : over.observedAt},
      ${over.listingComplete ?? true})
  `)
}

type HeadOptions = Readonly<{
  total?: number
  average?: number | null
  mode?: 'dark' | 'persist'
  /** Replaces the read generation the check takes right after Google answers. */
  generation?: number
}>

/** Run one head check against a page Google returns. */
async function headCheck(
  reviews: readonly GoogleReviewRead[],
  options: HeadOptions = {},
) {
  const page: GoogleReviewHeadResult = {
    status: 'ok',
    reviews,
    totalReviewCount: options.total ?? reviews.length,
    averageRating: options.average === undefined ? 4 : options.average,
    hasMore: false,
  }
  const warn = vi.fn()
  const run = createRunReviewHeadCheck({
    googleReviewApi: { readReviewsHead: vi.fn(async () => page) },
    repository: createReviewHeadCheckRepository(db),
    logger: { info: vi.fn(), warn },
    clock: () => new Date(clockAt.getTime() + tick++),
    persist: {
      observationWriter:
        options.generation === undefined
          ? writer
          : {
              ...writer,
              allocateReplyReadGeneration: async () => options.generation as number,
            },
      subjectKeyService,
      propertySourceEpoch: { getSourceEpoch: async () => ({ sourceEpoch: EPOCH }) },
      syncActivity: createReviewSyncActivityRecorder(db),
      newId: () => crypto.randomUUID(),
    },
  })
  const result = await run({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: EPOCH,
    locationName: LOCATION,
    mode: options.mode ?? 'persist',
  })
  return { result, warn }
}

const count = async (query: ReturnType<typeof sql>): Promise<number> => {
  const result = await db.execute(query)
  return Number(result.rows[0]?.count ?? 0)
}

const observationsOf = (externalId: string) =>
  count(sql`
    SELECT count(*)::int AS count FROM review_source_observations o
    JOIN reviews r ON r.id = o.review_id AND r.organization_id = o.organization_id
    WHERE r.organization_id = ${ORG} AND r.external_id = ${externalId}
  `)

const reviewRows = async () =>
  (
    await db.execute(sql`
      SELECT external_id, text FROM reviews WHERE organization_id = ${ORG} ORDER BY external_id
    `)
  ).rows

const factRows = async () =>
  (
    await db.execute(sql`
      SELECT review_count, average_rating, listing_complete, numbers_observed_at
      FROM review_google_reputation_snapshot_facts
      WHERE organization_id = ${ORG} ORDER BY evaluated_at, run_id
    `)
  ).rows

async function clear(): Promise<void> {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM google_reply_observations WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM review_provider_subjects WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${org}`,
    )
    await db.execute(
      sql`DELETE FROM review_provider_snapshot_runs WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${org}`)
  }
  await db.execute(
    sql`DELETE FROM review_sync_runs WHERE property_id IN (${PROPERTY}, ${OTHER_PROPERTY})`,
  )
  await db.execute(
    sql`DELETE FROM review_sync_state WHERE property_id IN (${PROPERTY}, ${OTHER_PROPERTY})`,
  )
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clear()
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${org}, 'Head persist test', ${org}, now())
    `)
  }
  const active = await db.execute(sql`
    SELECT key_version FROM review_provider_subject_hmac_key_versions WHERE state = 'active'
  `)
  const existing = active.rows[0]?.key_version
  if (existing == null) {
    await db.execute(sql`
      INSERT INTO review_provider_subject_hmac_key_versions
        (key_version, key_digest, state, generation, created_at, activated_at)
      VALUES
        (${TEST_KEY_VERSION}, ${'7'.repeat(64)}, 'active', 999996,
         transaction_timestamp(), transaction_timestamp())
    `)
    insertedTestKey = true
  } else {
    activeKeyVersion = String(existing)
  }
})

beforeEach(async () => {
  await clear()
  for (const [org, connection, property] of [
    [ORG, CONNECTION, PROPERTY],
    [OTHER_ORG, OTHER_CONNECTION, OTHER_PROPERTY],
  ] as const) {
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status
      ) VALUES (
        ${connection}, ${org}, ${`head-persist-subject-${org}`}, 'sealed-access',
        'sealed-refresh', now() + interval '1 hour',
        ARRAY['https://www.googleapis.com/auth/business.manage'], 'head-persist-user',
        'organization', 'active'
      )
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
      VALUES (${property}, ${org}, 'Head persist property',
        ${`head-persist-${property.slice(-4)}`}, 'UTC', ${EPOCH})
    `)
  }
  clockAt = new Date()
  tick = 0
})

afterAll(async () => {
  await clear()
  if (insertedTestKey) {
    await db.execute(sql`
      DELETE FROM review_provider_subject_hmac_key_versions
      WHERE key_version = ${TEST_KEY_VERSION}
    `)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  clearEventSchemas()
})

describe('a persisting head check (real PostgreSQL)', () => {
  it('writes only what differs: a new review and an edited one, not the unchanged one', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const same = providerReview('same')
    const edited = providerReview('edited')
    await observeEarlier(same, earlier)
    await observeEarlier(edited, earlier)
    await insertFact({ count: 2, average: 4 })
    clockAt = new Date()
    const sameBefore = await observationsOf(same.externalId)

    const { result } = await headCheck(
      [
        providerReview('new'),
        same,
        {
          ...edited,
          text: 'Edited on Google',
          sourceUpdatedAt: new Date(clockAt.getTime() - 60_000),
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

  it('writes nothing when every review on the page matches its stored copy', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const same = providerReview('same')
    await observeEarlier(same, earlier)
    await insertFact({ count: 1, average: 4 })
    clockAt = new Date()
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
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('fresh')], { total: 1, average: 4 })

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
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('fresh')], { total: 1, average: 4 })

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

  it('records the row as mode head, with what was stored', async () => {
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('fresh')], { total: 1, average: 4 })

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
    clockAt = new Date()

    // Generation 1 is older than the reply head the earlier read left behind.
    const { result, warn } = await headCheck(
      [
        {
          ...answered,
          replyText: 'Thanks, we hope to see you again',
          replyUpdatedAt: new Date(clockAt.getTime() - 5_000),
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
    await insertFact({ count: 0, average: null })

    const { result } = await headCheck([providerReview('fresh')], {
      total: 1,
      average: 4,
      mode: 'dark',
    })

    expect(result).toMatchObject({ persistence: null })
    expect(await reviewRows()).toEqual([])
    expect(await factRows()).toHaveLength(1)
    const runs = await db.execute(sql`
      SELECT mode FROM review_sync_runs WHERE property_id = ${PROPERTY}
    `)
    expect(runs.rows).toEqual([{ mode: 'head_dark' }])
  })

  it('does not touch another Property’s reviews or facts', async () => {
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('fresh')], { total: 1, average: 4 })

    const other = await count(sql`
      SELECT count(*)::int AS count FROM reviews WHERE organization_id = ${OTHER_ORG}
    `)
    expect(other).toBe(0)
  })
})

describe('a reply written on Google, seen by a head check (real PostgreSQL)', () => {
  const buildItem = (): InboxItem => ({
    id: INBOX_ITEM,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: '' as never,
    status: 'open',
    rating: 4,
    sourceDate: new Date(),
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  it('closes the Inbox item through the reply observation event', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const unanswered = providerReview('unanswered')
    const seen = await observeEarlier(unanswered, earlier)
    await insertFact({ count: 1, average: 4 })
    clockAt = new Date()
    const allowAll = async () => ({ allowed: true as const })
    const inboxStore = createAtomicInboxCommandStore(db, allowAll, () => clockAt)
    const item: InboxItem = { ...buildItem(), sourceId: seen.reviewId as never }
    await inboxStore.createItem(item, null, {
      materialReviewRevision: seen.sourceRevision,
    })

    const { result } = await headCheck(
      [
        {
          ...unanswered,
          replyText: 'Thank you for staying with us',
          replyUpdatedAt: new Date(clockAt.getTime() - 30_000),
        },
      ],
      { total: 1, average: 4 },
    )

    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedNew: 0, storedOther: 1, failed: 0 },
    })
    const events = await db.execute(sql`
      SELECT id, payload FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'review.reply.observed'
      ORDER BY created_at DESC
    `)
    expect(events.rows).toHaveLength(1)
    const observed = events.rows[0]?.payload as Record<string, unknown>
    expect(observed).toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
    })

    // The Inbox consumer's own step, from the event the head check published.
    const authority = createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(db),
    )
    const expectation = {
      organizationId: ORG,
      reviewId: seen.reviewId,
      propertyId: PROPERTY,
      observationRevision: Number(observed.observationRevision),
      sourceEpoch: Number(observed.sourceEpoch),
      materialReviewRevision: Number(observed.materialReviewRevision),
      change: observed.change,
      resolution: observed.resolution,
      provenance: observed.provenance,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      occurredAt: new Date(String(observed.occurredAt)),
    } as never
    const applied = await authority.withExactCurrent(expectation, (permit) =>
      inboxStore.applyReplyObservedOnce({
        eventId: String(events.rows[0]?.id),
        consumerName: 'inbox.on-reply-observed',
        item,
        currentObservation: permit,
        closeFact: inboxItemStatusChanged({
          inboxItemId: INBOX_ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: clockAt,
        }),
        reopenFact: inboxItemStatusChanged({
          inboxItemId: INBOX_ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          oldStatus: 'closed',
          newStatus: 'open',
          occurredAt: clockAt,
        }),
      }),
    )
    expect(applied.status).toBe('current')
    const closed = await db.execute(sql`
      SELECT status FROM inbox_items WHERE id = ${INBOX_ITEM}
    `)
    expect(closed.rows).toEqual([{ status: 'closed' }])
  })
})
