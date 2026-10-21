import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import type { GoogleReplyHead } from '../application/ports/reply-lookup.port'
import type { ReminderSlotKey } from '../application/ports/response-target.store'
import { releaseDueResponseTargetReminders } from '../application/use-cases/release-response-target-reminders'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { completeGoogleReviewTarget } from './google-review-target-completion'
import { createResponseTargetStore } from './response-target.store'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'

const MINUTE = 60_000
const ORG = organizationId('org-reminder-release-pg-0000000001')
const PROPERTY = propertyId('7a000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('7a000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('7a000000-0000-4000-8000-000000000003')
const PRIVATE_ITEM = inboxItemId('7a000000-0000-4000-8000-000000000004')
const PRIVATE_FEEDBACK = feedbackId('7a000000-0000-4000-8000-000000000005')
const OPENED_AT = new Date('2026-08-28T08:00:00.000Z')
const HALFWAY = new Date(OPENED_AT.getTime() + 30 * MINUTE)
const DUE = new Date(OPENED_AT.getTime() + 60 * MINUTE)

const db = getDb()
let pool: Pool
const targets = createResponseTargetStore(db)

const allowAll: InboxCommandAuthority = async () => ({ allowed: true })
const commandStore = () => createAtomicInboxCommandStore(db, allowAll, () => OPENED_AT)

const reviewItem = (): InboxItem => ({
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'review',
  sourceId: REVIEW,
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 4,
  sourceDate: OPENED_AT,
  platform: 'google',
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
})

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedBase(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Reminder Release Test', 'reminder-release-test', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Release Property', 'release-property', 'America/New_York', 0, NOW(), NOW())`,
    [PROPERTY, ORG],
  )
}

/** A Google-review cycle with a 60 minute target: halfway at +30, due at +60. */
async function seedGoogleReviewCycle(): Promise<void> {
  await seedBase()
  await pool.query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version,
       updated_by, created_at, updated_at
     ) VALUES ($1, 'google_review_response', 60, 1, 'user-reminder-release-00001', $2, $2)`,
    [ORG, OPENED_AT],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', 'external-reminder-release', 'locations/release-test',
       4, $4, $5, 0, 1, 0, 1, 1, $6, 'active', $4, $4
     )`,
    [
      REVIEW,
      ORG,
      PROPERTY,
      OPENED_AT,
      new Date('2027-08-28T08:00:00.000Z'),
      '0'.repeat(64),
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'reminder release review', 'measured', $5, 'active', $5, $5
     )`,
    [REVIEW, ORG, PROPERTY, '1'.repeat(64), OPENED_AT],
  )
  await commandStore().createItem(reviewItem(), null, {
    sourceRevision: 1,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
    openedAt: OPENED_AT,
    responseTarget: {
      reviewAuthority: {
        authority: 'review.current-response-target.v1',
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: REVIEW,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        eligibility: 'measured',
        responseTargetStartAt: OPENED_AT,
        rating: null,
      },
      targetStart: { basis: 'review_provenance' },
    },
  })
}

/** A private-feedback cycle on the built-in 48 hour target. */
async function seedPrivateFeedbackCycle(): Promise<void> {
  await seedBase()
  await commandStore().createItem(
    {
      ...reviewItem(),
      id: PRIVATE_ITEM,
      sourceType: 'feedback',
      sourceId: PRIVATE_FEEDBACK,
      platform: null,
      snippet: 'Private feedback',
    },
    null,
    {
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: null,
      openedAt: OPENED_AT,
    },
  )
}

const key = (reminderKind: ReminderSlotKey['reminderKind']): ReminderSlotKey => ({
  inboxItemId: ITEM,
  cycleNumber: 1,
  reminderKind,
})

const slotStates = async () =>
  (
    await pool.query<{
      reminder_kind: string
      delivered_at: Date | null
      cancelled_at: Date | null
    }>(
      `SELECT reminder_kind, delivered_at, cancelled_at
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
      [ITEM],
    )
  ).rows

const dueFacts = async () =>
  (
    await pool.query<{ reminder_kind: string }>(
      `SELECT payload->>'reminderKind' AS reminder_kind
       FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.response_target.reminder_due'
       ORDER BY payload->>'scheduledFor'`,
      [ORG],
    )
  ).rows.map((row) => row.reminder_kind)

const closeLikeAReplyWould = async (at: Date) => {
  const head = await createReviewHandlingCycleStore(db).findSourceHead?.(ITEM, ORG)
  if (!head) throw new Error('Handling Cycle head missing')
  await db.transaction((tx) => completeGoogleReviewTarget(tx, head, at))
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 6 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await clean()
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clean()
})

describe.sequential('Reminder release in two steps (PostgreSQL)', () => {
  it('lists a due Google review slot with what the decision needs', async () => {
    await seedGoogleReviewCycle()

    await expect(
      targets.listDueReminderCandidates({ now: HALFWAY, limit: 10 }),
    ).resolves.toEqual([
      {
        key: key('halfway'),
        organizationId: ORG,
        propertyId: PROPERTY,
        targetKind: 'google_review_response',
        scheduledFor: HALFWAY,
        targetStartAt: OPENED_AT,
        targetDueAt: DUE,
        sourceId: REVIEW,
        sourceRevision: 1,
      },
    ])
  })

  it('lists nothing before a slot is due and caps the batch at the limit', async () => {
    await seedGoogleReviewCycle()

    await expect(
      targets.listDueReminderCandidates({
        now: new Date(HALFWAY.getTime() - 1),
        limit: 10,
      }),
    ).resolves.toEqual([])
    await expect(
      targets.listDueReminderCandidates({ now: DUE, limit: 1 }),
    ).resolves.toHaveLength(1)
    await expect(
      targets.listDueReminderCandidates({ now: DUE, limit: 0 }),
    ).rejects.toThrow('Reminder batch limit must be 1–100')
  })

  it('takes no lock while listing: a writer holding the target row neither blocks it nor is blocked', async () => {
    await seedGoogleReviewCycle()
    const writer = await pool.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(
        `SELECT 1 FROM inbox_handling_cycle_response_targets
         WHERE inbox_item_id = $1 FOR UPDATE`,
        [ITEM],
      )
      await writer.query(`SET LOCAL lock_timeout = '2000ms'`)

      const listed = await Promise.race([
        targets.listDueReminderCandidates({ now: DUE, limit: 10 }),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 3_000)),
      ])
      expect(listed).not.toBe('blocked')
      expect(listed).toHaveLength(2)

      // A concurrent release leaves a locked target to its holder.
      await expect(
        targets.releaseReminderSlot({ key: key('target_passed'), now: DUE }),
      ).resolves.toBe('skipped')
    } finally {
      await writer.query('ROLLBACK')
      writer.release()
    }
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: null },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: null },
    ])
  })

  it('releases one slot with its fact, once', async () => {
    await seedGoogleReviewCycle()

    await expect(
      targets.releaseReminderSlot({ key: key('halfway'), now: HALFWAY }),
    ).resolves.toBe('released')
    await expect(
      targets.releaseReminderSlot({ key: key('halfway'), now: HALFWAY }),
    ).resolves.toBe('skipped')

    expect(await dueFacts()).toEqual(['halfway'])
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: HALFWAY, cancelled_at: null },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: null },
    ])
  })

  it('queues exactly one fact when two workers release the same slot at once', async () => {
    await seedGoogleReviewCycle()

    const results = await Promise.all([
      targets.releaseReminderSlot({ key: key('halfway'), now: HALFWAY }),
      targets.releaseReminderSlot({ key: key('halfway'), now: HALFWAY }),
    ])

    expect(results.filter((result) => result === 'released')).toHaveLength(1)
    expect(await dueFacts()).toEqual(['halfway'])
  })

  it('does not release a slot that is not yet due', async () => {
    await seedGoogleReviewCycle()

    await expect(
      targets.releaseReminderSlot({
        key: key('target_passed'),
        now: new Date(DUE.getTime() - 1),
      }),
    ).resolves.toBe('skipped')
    expect(await dueFacts()).toEqual([])
  })

  it('closes a superseded halfway without a fact', async () => {
    await seedGoogleReviewCycle()
    const lateRelease = new Date(DUE.getTime() + 5 * MINUTE)

    await expect(
      targets.releaseReminderSlot({ key: key('halfway'), now: lateRelease }),
    ).resolves.toBe('cancelled_superseded')

    expect(await dueFacts()).toEqual([])
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: lateRelease },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: null },
    ])
  })

  it('leaves a held slot pending, and the normal close then cancels it so nothing is ever delivered', async () => {
    await seedGoogleReviewCycle()
    // A hold writes nothing: the slot is still listed on the next tick.
    await expect(
      targets.listDueReminderCandidates({ now: DUE, limit: 10 }),
    ).resolves.toHaveLength(2)

    const closedAt = new Date(DUE.getTime() + MINUTE)
    await closeLikeAReplyWould(closedAt)

    await expect(
      targets.listDueReminderCandidates({ now: closedAt, limit: 10 }),
    ).resolves.toEqual([])
    await expect(
      targets.releaseReminderSlot({ key: key('target_passed'), now: closedAt }),
    ).resolves.toBe('skipped')
    expect(await dueFacts()).toEqual([])
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: closedAt },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: closedAt },
    ])
  })

  it('keeps the unconditional release working for the slots it always released', async () => {
    await seedGoogleReviewCycle()

    await expect(targets.releaseDueReminders({ now: DUE, limit: 10 })).resolves.toEqual({
      released: 1,
    })
    expect(await dueFacts()).toEqual(['target_passed'])
  })
})

describe.sequential('Pre-check tick over the real store (PostgreSQL)', () => {
  const answeringHead = (): GoogleReplyHead => ({
    reviewId: REVIEW,
    propertyId: PROPERTY,
    observationRevision: 2,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    state: 'live',
    change: 'added',
    resolution: 'external_current_live',
    provenance: 'external_or_unknown',
    matchedReplyId: null,
    matchedPublicationCycle: null,
    observedAt: new Date(OPENED_AT.getTime() + 10 * MINUTE),
  })

  const tick = (
    input: Readonly<{
      now: () => Date
      heads?: () => ReadonlyMap<string, GoogleReplyHead>
      check?: () => Promise<
        Awaited<
          ReturnType<
            Parameters<
              typeof releaseDueResponseTargetReminders
            >[0]['googleReviewCheck']['check']
          >
        >
      >
    }>,
  ) =>
    releaseDueResponseTargetReminders({
      targetStore: targets,
      replyLookup: {
        getGoogleReplyHeadsByReviewIds: async () => input.heads?.() ?? new Map(),
      },
      googleReviewCheck: { check: input.check ?? (async () => ({ status: 'read' })) },
      clock: input.now,
      logger: { warn: vi.fn() },
    })()

  it('neither delivers nor errors when the close completes the target while Google is being read', async () => {
    await seedGoogleReviewCycle()
    let now = DUE
    const result = await tick({
      now: () => now,
      check: async () => {
        // The reply observation's close path runs to completion while the
        // read is in flight. It would hang here if the tick held a lock.
        now = new Date(DUE.getTime() + 20_000)
        await Promise.race([
          closeLikeAReplyWould(now),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('close was blocked by the tick')), 3_000),
          ),
        ])
        return { status: 'read' }
      },
    })

    expect(result).toMatchObject({ checked: 1, released: 0, failed: 0 })
    expect(await dueFacts()).toEqual([])
  })

  it('holds the target-passed slot from the local head, writes nothing for it, and the close then cancels it', async () => {
    await seedGoogleReviewCycle()
    const check = vi.fn(async () => ({ status: 'read' as const }))

    const result = await tick({
      now: () => DUE,
      heads: () => new Map([[REVIEW, answeringHead()]]),
      check,
    })

    expect(result).toMatchObject({ heldLocal: 1, released: 0, checked: 0 })
    expect(check).not.toHaveBeenCalled()
    // The halfway slot is superseded once the target has passed: closed with
    // no fact, as before. The held target-passed slot is untouched.
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: DUE },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: null },
    ])

    const closedAt = new Date(DUE.getTime() + MINUTE)
    await closeLikeAReplyWould(closedAt)
    await expect(
      tick({ now: () => new Date(DUE.getTime() + 5 * MINUTE) }),
    ).resolves.toMatchObject({ released: 0, checked: 0 })
    expect(await dueFacts()).toEqual([])
    expect(await slotStates()).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: DUE },
      { reminder_kind: 'target_passed', delivered_at: null, cancelled_at: closedAt },
    ])
  })

  it('leaves a deferred slot pending, then delivers it once the 15 minute cap has passed', async () => {
    await seedGoogleReviewCycle()
    const failing = async () => ({
      status: 'unavailable' as const,
      retry: 'later' as const,
    })

    await expect(
      tick({ now: () => new Date(DUE.getTime() + MINUTE), check: failing }),
    ).resolves.toMatchObject({ deferred: 1, released: 0 })
    await expect(
      tick({ now: () => new Date(DUE.getTime() + 6 * MINUTE), check: failing }),
    ).resolves.toMatchObject({ deferred: 1, released: 0 })
    expect(await dueFacts()).toEqual([])

    await expect(
      tick({ now: () => new Date(DUE.getTime() + 15 * MINUTE), check: failing }),
    ).resolves.toMatchObject({ released: 1, deferred: 0 })
    expect(await dueFacts()).toEqual(['target_passed'])

    // The one-shot guard: a later tick finds nothing left to deliver.
    await expect(
      tick({ now: () => new Date(DUE.getTime() + 20 * MINUTE), check: failing }),
    ).resolves.toMatchObject({ released: 0, checked: 0 })
    expect(await dueFacts()).toEqual(['target_passed'])
  })

  it('releases a private feedback slot even when Google is down', async () => {
    await seedPrivateFeedbackCycle()
    const check = vi.fn(async () => {
      throw new Error('Google timed out')
    })
    const dueAt = new Date(OPENED_AT.getTime() + 48 * 60 * MINUTE)

    const result = await tick({ now: () => dueAt, check })

    expect(check).not.toHaveBeenCalled()
    expect(result).toMatchObject({ released: 1, checked: 0, failed: 0 })
    expect(await dueFacts()).toEqual(['target_passed'])
  })
})
