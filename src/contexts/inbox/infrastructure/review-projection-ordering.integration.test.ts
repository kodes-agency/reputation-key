import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

import type { ConsumerEvent } from '#/shared/outbox'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createReviewResponseTargetAuthorityAdapter } from './adapters/review-response-target-authority.adapter'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'
import {
  handleInboxReviewCreated,
  handleInboxReviewUpdated,
  type InboxConsumerDeps,
} from './outbox-consumers'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '../application/ports/review-source-lookup.port'
import type { FeedbackLookupPort } from '../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../application/ports/property-lookup.port'

const ORG = organizationId('org-inbox-projection-ordering-1')
const PROPERTY = propertyId('7c000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('7c000000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('7c000000-0000-4000-8000-000000000003')
const OBSERVED = [
  new Date('2026-08-01T12:00:00.000Z'),
  new Date('2026-08-02T12:00:00.000Z'),
  new Date('2026-08-03T12:00:00.000Z'),
] as const
const TARGET_STARTS = [
  new Date('2026-08-01T11:00:00.000Z'),
  new Date('2026-08-02T11:00:00.000Z'),
  new Date('2026-08-03T11:00:00.000Z'),
] as const
const DELIVERED_AT = new Date('2026-08-20T12:00:00.000Z')
const ERASED_AT = new Date('2026-08-10T12:00:00.000Z')

let lease: TestLease
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const reviewLookup = {
  getReviewSnippetById: async () => ({ status: 'not_found' as const }),
  getReviewSnippetsByIds: async () => new Map(),
  findEligibleReviewIds: async () => [],
} satisfies ReviewLookupPort

const reviewSourceLookup = {
  getReviewSourceMetaById: async () => null,
  getReviewSourceMetaByIds: async () => [],
  listReviewSources: async () => [],
} satisfies ReviewSourceLookupPort

const feedbackLookup = {
  getFeedbackSnippetById: async () => null,
  getFeedbackSnippetsByIds: async () => new Map(),
  findEligibleFeedbackIds: async () => [],
} satisfies FeedbackLookupPort

const propertyLookup = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
} satisfies PropertyLookupPort

const event = (
  kind: 'review.created' | 'review.updated',
  revision: 1 | 2 | 3,
): ConsumerEvent => ({
  eventId: `7c000000-0000-4000-8000-00000000001${revision}`,
  eventType: kind,
  eventVersion: 1,
  payload: {
    reviewId: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    sourceEpoch: 0,
    sourceRevision: revision,
    analysisSequence: revision,
    occurredAt: OBSERVED[revision - 1].toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
  sourceAggregateId: REVIEW,
})

const sourceEvents = [
  event('review.created', 1),
  event('review.updated', 2),
  event('review.updated', 3),
] as const

const permutations = <T>(values: readonly T[]): T[][] =>
  values.length <= 1
    ? [[...values]]
    : values.flatMap((value, index) =>
        permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [
          value,
          ...tail,
        ]),
      )

async function cleanInboxProjection(seedSourceEvents = true): Promise<void> {
  await pool.query(
    `DELETE FROM event_consumer_receipts
     WHERE consumer_name IN ('inbox.on-review-created', 'inbox.on-review-updated')`,
  )
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  if (seedSourceEvents) {
    for (const sourceEvent of sourceEvents) {
      await pool.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id,
           property_id, source_context, source_aggregate_id, created_at
         ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'review', $6, $7)`,
        [
          sourceEvent.eventId,
          sourceEvent.eventType,
          JSON.stringify(sourceEvent.payload),
          ORG,
          PROPERTY,
          REVIEW,
          OBSERVED[0],
        ],
      )
    }
  }
}

async function cleanAll(): Promise<void> {
  await cleanInboxProjection(false)
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedActiveReview(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox projection ordering', $2, NOW())`,
    [ORG, `inbox-projection-ordering-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Ordering property', $3, 'UTC', 0, NOW(), NOW())`,
    [PROPERTY, ORG, `inbox-projection-ordering-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_created_at, source_updated_at, first_fetched_at, last_fetched_at,
       content_expires_at, source_epoch, source_revision,
       source_observation_sequence, analysis_sequence, ai_source_byte_length,
       ai_source_digest, source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', 'ordering-review', 'locations/ordering', 5, $4, $5,
       $6, $7, $6, $7, $5, 0, 3, 3, 3, 1, $8, 'active', $6, $7
     )`,
    [
      REVIEW,
      ORG,
      PROPERTY,
      TARGET_STARTS[0],
      new Date('2027-08-01T12:00:00.000Z'),
      OBSERVED[0],
      OBSERVED[2],
      'a'.repeat(64),
    ],
  )
  for (const [index, observedAt] of OBSERVED.entries()) {
    await pool.query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 0, 'review-material-v1', $5, $5, $6,
         $7, 'measured', $8, 'active', $9, $9
       )`,
      [
        REVIEW,
        index + 1,
        ORG,
        PROPERTY,
        String(index + 1).repeat(64),
        3 + index,
        `revision-${index + 1}`,
        TARGET_STARTS[index],
        observedAt,
      ],
    )
  }
}

function deps(): InboxConsumerDeps {
  const database = getDb()
  const inboxRepo = createInboxRepository(
    database,
    { reviewLookup, feedbackLookup, propertyLookup },
    { clock: () => DELIVERED_AT, logger: createMockLogger() },
  )
  return {
    commandStore: createAtomicInboxCommandStore(
      database,
      allowAllCommandAuthority,
      () => DELIVERED_AT,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(database),
    replyObservationAuthority: {
      withExactCurrent: async () => ({ status: 'obsolete' }),
    },
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(database),
    ),
    sourceTransitionAuthority: {
      withExactCurrent: async () => ({ status: 'obsolete' }),
    },
    reviewLookup,
    reviewSourceLookup,
    inboxRepo,
    idGen: () => ITEM,
    clock: () => DELIVERED_AT,
    logger: createMockLogger(),
  }
}

async function deliver(candidate: ConsumerEvent): Promise<void> {
  if (candidate.eventType === 'review.created') {
    await handleInboxReviewCreated(deps(), candidate)
    return
  }
  await handleInboxReviewUpdated(deps(), candidate)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await cleanAll()
  clearEventSchemas()
  await lease.release()
})

beforeEach(async () => {
  await cleanAll()
  await seedActiveReview()
  await cleanInboxProjection()
})

describe.sequential('Review source event delivery-order convergence', () => {
  it('materializes the same complete revision history for every delivery order', async () => {
    const observedStates: unknown[] = []
    for (const order of permutations(sourceEvents)) {
      await cleanInboxProjection()
      for (const candidate of order) {
        await deliver(candidate)
        await deliver(candidate)
      }

      const itemRows = await pool.query(
        `SELECT id, status, source_date, platform
         FROM inbox_items WHERE organization_id = $1`,
        [ORG],
      )
      const cycleRows = await pool.query(
        `SELECT cycle_number, source_revision, opened_at
         FROM inbox_handling_cycles
         WHERE organization_id = $1
         ORDER BY cycle_number`,
        [ORG],
      )
      const transitionRows = await pool.query(
        `SELECT cycle_number, state_revision, kind AS transition_kind,
                transition_reason, trigger_event_id
         FROM inbox_handling_cycle_transitions
         WHERE organization_id = $1
         ORDER BY state_revision`,
        [ORG],
      )
      const targetRows = await pool.query(
        `SELECT cycle_number, source_revision, performance_eligibility,
                start_at, result, stop_reason
         FROM inbox_handling_cycle_response_targets
         WHERE organization_id = $1
         ORDER BY cycle_number`,
        [ORG],
      )
      const state = {
        items: itemRows.rows,
        cycles: cycleRows.rows,
        transitions: transitionRows.rows,
        targets: targetRows.rows,
      }
      observedStates.push(state)
    }

    expect(observedStates).toHaveLength(6)
    for (const state of observedStates.slice(1)) {
      expect(state).toEqual(observedStates[0])
    }
    expect(observedStates[0]).toMatchObject({
      items: [{ id: ITEM, status: 'open', platform: 'google' }],
      cycles: [
        { cycle_number: '1', source_revision: '1' },
        { cycle_number: '2', source_revision: '2' },
        { cycle_number: '3', source_revision: '3' },
      ],
      targets: [
        { cycle_number: '1', result: 'cancelled' },
        { cycle_number: '2', result: 'cancelled' },
        { cycle_number: '3', result: null },
      ],
    })
    expect(
      (observedStates[0] as { transitions: Array<{ trigger_event_id: string | null }> })
        .transitions,
    ).toHaveLength(5)
    expect(
      (
        observedStates[0] as { transitions: Array<{ trigger_event_id: string | null }> }
      ).transitions.every((transition) => transition.trigger_event_id === null),
    ).toBe(true)
  })

  it('leaves the manager concurrency token untouched when a tick projects nothing new', async () => {
    // `command_revision` is what the detail pane submits back with the next
    // manager command. Convergence runs on every relay tick for the review, so
    // bumping it on a tick that changes nothing invalidated an idle open page
    // and made ordinary interactions fail with `revision_conflict`.
    await cleanInboxProjection()
    for (const candidate of sourceEvents) await deliver(candidate)

    const readRevision = async (): Promise<string> => {
      const rows = await pool.query<{ command_revision: string }>(
        'SELECT command_revision FROM inbox_items WHERE organization_id = $1',
        [ORG],
      )
      return rows.rows[0]!.command_revision
    }
    const settled = await readRevision()

    for (const candidate of sourceEvents) await deliver(candidate)
    expect(await readRevision()).toBe(settled)
  })

  it('late creation after erasure keeps stable history closed and creates no targets', async () => {
    await pool.query(
      `UPDATE reviews SET
         external_id = NULL, external_location_id = NULL,
         google_connection_id = NULL, reviewer_name = NULL,
         reviewer_profile_photo_url = NULL, rating = NULL, text = NULL,
         translated_text = NULL, language_code = NULL, reviewed_at = NULL,
         source_created_at = NULL, source_updated_at = NULL, content_hash = NULL,
         ai_source_byte_length = NULL, ai_source_digest = NULL,
         source_content_state = 'source_expired', source_content_erased_at = $2,
         updated_at = $2
       WHERE organization_id = $1`,
      [ORG, ERASED_AT],
    )
    await pool.query(
      `UPDATE material_review_revisions SET
         rating = NULL, normalized_text = NULL,
         content_state = 'source_expired', content_erased_at = $2, updated_at = $2
       WHERE organization_id = $1`,
      [ORG, ERASED_AT],
    )

    await expect(deliver(sourceEvents[0])).resolves.toBeUndefined()

    const [itemRows, cycleRows, targetRows] = await Promise.all([
      pool.query(`SELECT status, closed_at FROM inbox_items WHERE organization_id = $1`, [
        ORG,
      ]),
      pool.query(
        `SELECT cycle_number, source_revision FROM inbox_handling_cycles
         WHERE organization_id = $1 ORDER BY cycle_number`,
        [ORG],
      ),
      pool.query(
        `SELECT cycle_number FROM inbox_handling_cycle_response_targets
         WHERE organization_id = $1`,
        [ORG],
      ),
    ])
    expect(itemRows.rows).toEqual([{ status: 'closed', closed_at: ERASED_AT }])
    expect(cycleRows.rows).toEqual([
      { cycle_number: '1', source_revision: '1' },
      { cycle_number: '2', source_revision: '2' },
      { cycle_number: '3', source_revision: '3' },
    ])
    expect(targetRows.rows).toEqual([])
  })
})
