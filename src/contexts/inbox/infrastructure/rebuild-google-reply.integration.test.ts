// The Inbox projection rebuild reads Google's reply truth, not only RepKey's
// replies. A reply written directly on Google exists only as a Google reply
// observation (its head says `live`): the legacy `google_sync` row in
// `replies` is deleted once that observation is recorded. Reading `replies`
// alone, a rebuild never stamped such a reply and recreated a missing item as
// open over a reply Google already showed — an item nobody could close, since
// Review closure is provider-only and its observed fact had long since given
// up waiting for the item.
//
// The rules (decided 2026-10-18, recorded in the rebuild use case and the
// Inbox CONTEXT):
//  - firstReplyPublishedAt is the earliest of RepKey's published replies and,
//    when the head is live, the time Google reports for that reply
//    (`provider_updated_at`, else when RepKey read it) — the time rule of the
//    reply lookup and of Reporting's reply rate.
//  - An item the rebuild CREATES is created closed when, under Review's
//    exact-current observation permit, Google shows a reply answering the
//    review's current revision: the same predicate `inbox.on-reply-observed`
//    closes on. No facts are recorded, as for the create itself.
//  - An EXISTING item's status is never changed: open over a live reply can be
//    a manager's reopen or a guest edit the reply does not answer.
//
// Real PostgreSQL, real Review authority, fixed clock.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  type ReviewId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Review } from '#/contexts/review/domain/types'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createReviewReplyObservationAuthority } from '#/contexts/review/infrastructure/reply-observation-authority'
import type { InboxItem } from '../domain/types'
import { rebuildInboxProjection } from '../application/use-cases/rebuild-inbox-projection'
import { createInboxRepository } from './repositories/inbox.repository'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { createReviewSourceLookupAdapter } from './adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from './adapters/reply-lookup.adapter'
import { createReplyObservationAuthorityAdapter } from './adapters/reply-observation-authority.adapter'

const ORG = organizationId('org-inbox-rebuild-google-reply-0001')
const PROP = propertyId('5e100000-0000-4000-8000-000000000001')
const NOW = new Date('2026-10-18T09:00:00.000Z')
const WRITTEN_ON_GOOGLE = new Date('2026-10-02T08:15:00.000Z')
const READ_FROM_GOOGLE = new Date('2026-10-03T06:00:00.000Z')

const REVIEW = {
  missingReplied: reviewId('5e100000-0000-4000-8000-0000000000a1'),
  existingReplied: reviewId('5e100000-0000-4000-8000-0000000000a2'),
  missingDeleted: reviewId('5e100000-0000-4000-8000-0000000000a3'),
  missingEditedAfterReply: reviewId('5e100000-0000-4000-8000-0000000000a4'),
  missingNoUpdateTime: reviewId('5e100000-0000-4000-8000-0000000000a5'),
} as const
const EXISTING_ITEM = inboxItemId('5e100000-0000-4000-8000-0000000000b2')

let pool: Pool
const db = getDb()

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

const noLookups = {
  reviewLookup: {
    getReviewSnippetById: async () => ({ status: 'not_found' as const }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  },
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

function makeRebuild(database: Database = db) {
  const reviewRepo = createReviewRepository(database, () => NOW)
  const replyRepo = createReplyRepository(database, () => NOW)
  const repo = createInboxRepository(database, noLookups, {
    clock: () => NOW,
    logger: noopLogger,
  })
  const commandStore = createAtomicInboxCommandStore(
    database,
    async () => ({ allowed: true }),
    () => NOW,
  )
  const rebuild = rebuildInboxProjection({
    repo,
    commandStore,
    reviewSourceLookup: createReviewSourceLookupAdapter({
      findById: (id, orgId) => reviewRepo.findById(id, orgId),
      findByIds: (ids, orgId) => reviewRepo.findByIds(ids, orgId),
      findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
      findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
    }),
    replyLookup: createReplyLookupAdapter({
      findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
      getCurrentGoogleReplyByReviewId: async () => null,
      findMilestonesByReviewIds: (ids, orgId) =>
        replyRepo.findMilestonesByReviewIds(ids, orgId),
      findCurrentGoogleReplyHeadsByReviewIds: (ids, orgId) =>
        replyRepo.findCurrentGoogleReplyHeadsByReviewIds(ids, orgId),
      findStatesByReviewIds: (ids, orgId) => replyRepo.findStatesByReviewIds(ids, orgId),
      findReviewIdsByReplyStage: (orgId, propertyIds) =>
        replyRepo.findReviewIdsByReplyStage(orgId, propertyIds),
    }),
    replyObservationAuthority: createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(database),
    ),
    idGen: () => inboxItemId(crypto.randomUUID()),
    clock: () => NOW,
    logger: noopLogger,
  })
  return { rebuild, repo, reviewRepo, commandStore }
}

function makeReview(
  id: ReviewId,
  text = 'A lovely stay',
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id,
    organizationId: ORG,
    propertyId: PROP,
    platform: 'google',
    externalId: `ext-${id}`,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-10-01T00:00:00.000Z'),
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
  }
}

/** The review as Google serves it; returns its current material revision. */
async function observeReview(id: ReviewId, text?: string): Promise<number> {
  const stored = await createReviewRepository(db, () => NOW).upsert(
    makeReview(id, text),
    NOW,
  )
  return stored.sourceRevision
}

type GoogleReplySeed = Readonly<{
  state: 'live' | 'absent'
  materialReviewRevision: number
  providerUpdatedAt?: Date | null
}>

/** What Google shows for a review now: one observation and the head on it. */
async function observeGoogleReply(id: ReviewId, seed: GoogleReplySeed): Promise<void> {
  const live = seed.state === 'live'
  const key = id.replaceAll('-', '').repeat(2)
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO google_reply_observations (
       organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance,
       normalized_text, normalization_version, normalized_digest,
       provider_updated_at, observed_at, content_expires_at
     ) VALUES ($1, $2, $3, 1, $4, $4, 0, $5, 1, $6, $7, $8, 'provider_snapshot', $9,
               $10, 'google-reply-v1', $11, $12, $13, '2027-01-01T00:00:00Z')
     RETURNING id`,
    [
      ORG,
      PROP,
      id,
      key,
      seed.materialReviewRevision,
      seed.state,
      live ? 'added' : 'deleted',
      live ? 'external_current_live' : 'absent',
      live ? 'external_or_unknown' : 'none',
      live ? 'Thank you for staying' : null,
      live ? 'c'.repeat(64) : null,
      seed.providerUpdatedAt === undefined ? WRITTEN_ON_GOOGLE : seed.providerUpdatedAt,
      READ_FROM_GOOGLE,
    ],
  )
  await pool.query(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id,
       observation_revision, source_epoch, material_review_revision, state,
       provenance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, 0, $5, $6, $7, $8, $8)`,
    [
      id,
      ORG,
      PROP,
      inserted.rows[0]?.id,
      seed.materialReviewRevision,
      seed.state,
      live ? 'external_or_unknown' : 'none',
      READ_FROM_GOOGLE,
    ],
  )
}

async function seedCanonicalState(): Promise<void> {
  // Answered on Google, never projected: the item comes back closed.
  const missingReplied = await observeReview(REVIEW.missingReplied)
  await observeGoogleReply(REVIEW.missingReplied, {
    state: 'live',
    materialReviewRevision: missingReplied,
  })

  // Answered on Google while its item is open: stamped, never closed.
  const existingReplied = await observeReview(REVIEW.existingReplied)
  await observeGoogleReply(REVIEW.existingReplied, {
    state: 'live',
    materialReviewRevision: existingReplied,
  })
  const { commandStore } = makeRebuild()
  await commandStore.createItem(existingItem(), null, {
    materialReviewRevision: existingReplied,
  })

  // The reply Google showed is gone: nothing to stamp, the item stays open.
  const missingDeleted = await observeReview(REVIEW.missingDeleted)
  await observeGoogleReply(REVIEW.missingDeleted, {
    state: 'absent',
    materialReviewRevision: missingDeleted,
  })

  // Replied, then the guest edited the review: the reply was published, but
  // it answers the earlier revision, so the item is new work.
  const answered = await observeReview(REVIEW.missingEditedAfterReply)
  await observeGoogleReply(REVIEW.missingEditedAfterReply, {
    state: 'live',
    materialReviewRevision: answered,
  })
  await observeReview(REVIEW.missingEditedAfterReply, 'A lovely stay, edited')

  // Google gave no update time: the reply counts from when RepKey read it.
  const noUpdateTime = await observeReview(REVIEW.missingNoUpdateTime)
  await observeGoogleReply(REVIEW.missingNoUpdateTime, {
    state: 'live',
    materialReviewRevision: noUpdateTime,
    providerUpdatedAt: null,
  })
}

function existingItem(): InboxItem {
  return {
    id: EXISTING_ITEM,
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: REVIEW.existingReplied,
    status: 'open',
    rating: null,
    sourceDate: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
  }
}

async function itemFor(id: ReviewId) {
  return makeRebuild().repo.findBySource('review', id, ORG)
}

async function transitionsFor(id: ReviewId) {
  const rows = await pool.query<{
    kind: string
    transition_reason: string
    actor_type: string
    trigger_event_id: string | null
    transitioned_at: Date
  }>(
    `SELECT t.kind, t.transition_reason, t.actor_type, t.trigger_event_id,
            t.transitioned_at
       FROM inbox_handling_cycle_transitions t
       JOIN inbox_items i ON i.id = t.inbox_item_id
      WHERE i.organization_id = $1 AND i.source_id = $2
      ORDER BY t.state_revision`,
    [ORG, id],
  )
  return rows.rows
}

async function cycleHeadStatus(id: ReviewId): Promise<string | undefined> {
  const rows = await pool.query<{ status: string }>(
    `SELECT h.status FROM inbox_handling_cycle_heads h
       JOIN inbox_items i ON i.id = h.inbox_item_id
      WHERE i.organization_id = $1 AND i.source_id = $2`,
    [ORG, id],
  )
  return rows.rows[0]?.status
}

async function outboxFactCount(): Promise<number> {
  const rows = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM outbox_events
      WHERE organization_id = $1 AND event_type LIKE 'inbox.%'`,
    [ORG],
  )
  return Number(rows.rows[0]?.n ?? 0)
}

async function clean(): Promise<void> {
  for (const table of [
    'inbox_items',
    'google_reply_observation_heads',
    'google_reply_observations',
    'replies',
    'reviews',
    'outbox_events',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await seedOrgs(pool, [ORG])
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Rebuild Google reply', 'rebuild-google-reply', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP, ORG],
  )
})

beforeEach(async () => {
  await clean()
  await seedCanonicalState()
})

afterAll(async () => {
  await clean()
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  await pool.end()
})

describe.sequential('rebuildInboxProjection reads replies written on Google', () => {
  it('recreates a missing item closed when Google shows a reply to the current review', async () => {
    const { rebuild } = makeRebuild()

    const report = await rebuild({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 4, closed: 2, dryRun: false })
    const item = await itemFor(REVIEW.missingReplied)
    expect(item?.status).toBe('closed')
    expect(item?.closedAt).toEqual(READ_FROM_GOOGLE)
    expect(item?.firstReplyPublishedAt).toEqual(WRITTEN_ON_GOOGLE)
    expect(await cycleHeadStatus(REVIEW.missingReplied)).toBe('closed')
    // History never shows the close before the open: the cycle opens no
    // later than Google was seen answering the review.
    expect(await transitionsFor(REVIEW.missingReplied)).toEqual([
      {
        kind: 'opened',
        transition_reason: 'review_observed',
        actor_type: 'provider',
        trigger_event_id: null,
        transitioned_at: READ_FROM_GOOGLE,
      },
      {
        kind: 'closed',
        transition_reason: 'external_reply_observed',
        actor_type: 'provider',
        trigger_event_id: null,
        transitioned_at: READ_FROM_GOOGLE,
      },
    ])
    // The row was written by this repair, so it is not back-dated.
    expect(item?.updatedAt).toEqual(NOW)
    // Repair, not new information: no created, status or cycle facts.
    expect(await outboxFactCount()).toBe(0)
  })

  it('counts a reply Google gave no update time from when RepKey read it', async () => {
    await makeRebuild().rebuild({ organizationId: ORG, dryRun: false })

    const item = await itemFor(REVIEW.missingNoUpdateTime)
    expect(item?.status).toBe('closed')
    expect(item?.firstReplyPublishedAt).toEqual(READ_FROM_GOOGLE)
  })

  it('stamps an existing open item without closing it', async () => {
    await makeRebuild().rebuild({ organizationId: ORG, dryRun: false })

    const item = await itemFor(REVIEW.existingReplied)
    expect(item?.status).toBe('open')
    expect(item?.closedAt).toBeNull()
    expect(item?.firstReplyPublishedAt).toEqual(WRITTEN_ON_GOOGLE)
    expect(await cycleHeadStatus(REVIEW.existingReplied)).toBe('open')
  })

  it('leaves new work open: a deleted Google reply, or one that answers an earlier revision', async () => {
    await makeRebuild().rebuild({ organizationId: ORG, dryRun: false })

    const deleted = await itemFor(REVIEW.missingDeleted)
    expect(deleted?.status).toBe('open')
    expect(deleted?.firstReplyPublishedAt).toBeNull()

    const edited = await itemFor(REVIEW.missingEditedAfterReply)
    expect(edited?.status).toBe('open')
    expect(edited?.firstReplyPublishedAt).toEqual(WRITTEN_ON_GOOGLE)
    expect(await cycleHeadStatus(REVIEW.missingEditedAfterReply)).toBe('open')
  })

  it('reports the same repair on a dry run and writes nothing', async () => {
    const report = await makeRebuild().rebuild({ organizationId: ORG, dryRun: true })

    expect(report).toMatchObject({ created: 4, closed: 2, milestones: 4, dryRun: true })
    expect(await itemFor(REVIEW.missingReplied)).toBeNull()
    expect((await itemFor(REVIEW.existingReplied))?.firstReplyPublishedAt).toBeNull()
  })

  it('converges: a second run repairs nothing', async () => {
    const { rebuild } = makeRebuild()
    await rebuild({ organizationId: ORG, dryRun: false })

    const second = await rebuild({ organizationId: ORG, dryRun: false })

    expect(second).toMatchObject({ created: 0, closed: 0, milestones: 0 })
  })
})
