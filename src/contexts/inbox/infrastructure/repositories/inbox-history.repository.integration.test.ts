import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { inboxItemId, organizationId } from '#/shared/domain/ids'
import { createInboxHistoryRepository } from './inbox-history.repository'

const ORG_ID = organizationId('org-inbox-history-000000000000001')
const OTHER_ORG_ID = organizationId('org-inbox-history-000000000000002')
const PROPERTY_ID = '7b000000-0000-4000-8000-000000000001'
const REVIEW_ID = '7b000000-0000-4000-8000-000000000002'
const ITEM_ID = inboxItemId('7b000000-0000-4000-8000-000000000003')
const ACTOR_ID = 'user-inbox-history-actor-0000001'
const ASSIGNEE_ID = 'user-inbox-history-assignee-001'
const T0 = new Date('2026-08-20T10:00:00.000Z')
const DIGEST = 'c'.repeat(64)

const at = (offsetMinutes: number) => new Date(T0.getTime() + offsetMinutes * 60_000)

const db: Database = getDb()
let pool: Pool

async function clean(): Promise<void> {
  for (const org of [ORG_ID, OTHER_ORG_ID]) {
    await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM material_review_revisions WHERE organization_id = $1', [
      org,
    ])
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
  }
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
}

async function seedMaterialRevision(revision: number): Promise<void> {
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 0, 'review-material-v1', $5, $5, 4,
               $6, 'active', $7, $7)`,
    [
      REVIEW_ID,
      revision,
      ORG_ID,
      PROPERTY_ID,
      String(revision).repeat(64).slice(0, 64),
      `material-${revision}`,
      T0,
    ],
  )
}

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox History Test', 'inbox-history-0001', NOW())`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox History Other', 'inbox-history-0002', NOW())`,
    [OTHER_ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'History Property', 'history-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY_ID, ORG_ID],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/history', 4, $5, $6,
               0, 2, 1, 1, 1, $7, 'active', $5, $5)`,
    [
      REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      `external-${REVIEW_ID}`,
      T0,
      new Date('2027-08-20T10:00:00.000Z'),
      DIGEST,
    ],
  )
  await seedMaterialRevision(1)
  await seedMaterialRevision(2)
}

/**
 * A three-cycle Review item: observed, superseded by a material revision, then
 * manually reopened with reason `other` plus its explanation. The assignee
 * loses eligibility during the reopen.
 */
async function seedThreeCycleItem(): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, assigned_to, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 'open', $5, 'google', NULL, 3, $5, $5)`,
    [ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, T0],
  )

  const cycle = async (
    cycleNumber: number,
    sourceRevision: number,
    openedReason: string,
    supersedes: number | null,
    openedBy: string | null,
    openedAt: Date,
    manualReopenReason: string | null = null,
    manualReopenExplanation: string | null = null,
  ) =>
    pool.query(
      `INSERT INTO inbox_handling_cycles (
         inbox_item_id, cycle_number, organization_id, property_id, source_type,
         source_id, source_revision, review_id, material_review_revision,
         opened_reason, manual_reopen_reason, manual_reopen_explanation,
         supersedes_cycle_number, opened_by, opened_at, created_at
       ) VALUES ($1, $2, $3, $4, 'review', $5, $6, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        ITEM_ID,
        cycleNumber,
        ORG_ID,
        PROPERTY_ID,
        REVIEW_ID,
        sourceRevision,
        openedReason,
        manualReopenReason,
        manualReopenExplanation,
        supersedes,
        openedBy,
        openedAt,
      ],
    )

  await cycle(1, 1, 'review_observed', null, null, at(0))
  await cycle(2, 2, 'material_revision_changed', 1, null, at(10))
  await cycle(
    3,
    2,
    'manual_reopen',
    2,
    ACTOR_ID,
    at(30),
    'other',
    'Guest called the front desk to add context',
  )

  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 2, $4, 3, 2, 5, 'open', $5, $5)`,
    [ITEM_ID, ORG_ID, PROPERTY_ID, REVIEW_ID, T0],
  )

  const transition = async (
    stateRevision: number,
    cycleNumber: number,
    sourceRevision: number,
    kind: string,
    reason: string,
    actorType: string,
    actorUserId: string | null,
    transitionedAt: Date,
  ) =>
    pool.query(
      `INSERT INTO inbox_handling_cycle_transitions (
         inbox_item_id, state_revision, cycle_number, organization_id, property_id,
         source_type, source_id, source_revision, kind, transition_reason,
         actor_type, actor_user_id, transitioned_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'review', $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        ITEM_ID,
        stateRevision,
        cycleNumber,
        ORG_ID,
        PROPERTY_ID,
        REVIEW_ID,
        sourceRevision,
        kind,
        reason,
        actorType,
        actorUserId,
        transitionedAt,
      ],
    )

  await transition(1, 1, 1, 'opened', 'review_observed', 'provider', null, at(0))
  await transition(
    2,
    1,
    1,
    'closed',
    'superseded_by_source_revision',
    'system',
    null,
    at(10),
  )
  await transition(
    3,
    2,
    2,
    'reopened',
    'material_revision_changed',
    'provider',
    null,
    at(10),
  )
  await transition(4, 2, 2, 'closed', 'confirmed_on_google', 'provider', null, at(20))
  await transition(5, 3, 2, 'reopened', 'manual_reopen', 'user', ACTOR_ID, at(30))

  await pool.query(
    `INSERT INTO inbox_assignment_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, previous_assignee, next_assignee, reason,
       actor_user_id, occurred_at, created_at
     ) VALUES ($1, 2, $2, $3, 2, NULL, $4, 'assign', $5, $6, $6)`,
    [ITEM_ID, ORG_ID, PROPERTY_ID, ASSIGNEE_ID, ACTOR_ID, at(15)],
  )
  // Eligibility loss during the reopen: the system unassigns, so there is no
  // next assignee and no acting user.
  await pool.query(
    `INSERT INTO inbox_assignment_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, previous_assignee, next_assignee, reason,
       actor_user_id, occurred_at, created_at
     ) VALUES ($1, 3, $2, $3, 3, $4, NULL, 'eligibility_lost', NULL, $5, $5)`,
    [ITEM_ID, ORG_ID, PROPERTY_ID, ASSIGNEE_ID, at(31)],
  )
  await pool.query(
    `INSERT INTO inbox_escalation_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, kind, actor_user_id, occurred_at, created_at
     ) VALUES ($1, 4, $2, $3, 3, 'escalated', $4, $5, $5)`,
    [ITEM_ID, ORG_ID, PROPERTY_ID, ACTOR_ID, at(32)],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedScope()
})

describe.sequential('Inbox Handling History repository (PostgreSQL)', () => {
  it('returns all three cycle openings and their transitions, superseded cycles intact', async () => {
    await seedThreeCycleItem()
    const repo = createInboxHistoryRepository(db)

    const page = await repo.findByInboxItemId({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
    })

    expect(page.truncated).toBe(false)
    const openings = page.entries.filter((entry) => entry.kind === 'cycle_opened')
    expect(openings.map((entry) => entry.cycleNumber)).toEqual([1, 2, 3])
    expect(openings.map((entry) => entry.detail)).toEqual([
      expect.objectContaining({ openedReason: 'review_observed' }),
      expect.objectContaining({
        openedReason: 'material_revision_changed',
        supersedesCycleNumber: 2 - 1,
      }),
      expect.objectContaining({
        openedReason: 'manual_reopen',
        manualReopenReason: 'other',
        manualReopenExplanation: 'Guest called the front desk to add context',
        supersedesCycleNumber: 3 - 1,
      }),
    ])

    const closes = page.entries.filter(
      (entry) =>
        entry.detail.kind === 'cycle_transition' && entry.detail.transition === 'closed',
    )
    expect(closes.map((entry) => entry.cycleNumber)).toEqual([1, 2])

    // The whole stream is ordered, and the superseded cycles were never
    // rewritten to point at the newest source revision.
    expect(page.entries.map((entry) => entry.id)).toEqual([
      `cycle:${ITEM_ID}:1`,
      `transition:${ITEM_ID}:1`,
      // Cycle 1 closes and cycle 2 opens at the same instant; the cycle number
      // orders them, so the close of the older cycle is told first.
      `transition:${ITEM_ID}:2`,
      `cycle:${ITEM_ID}:2`,
      `transition:${ITEM_ID}:3`,
      `assignment:${ITEM_ID}:2`,
      `transition:${ITEM_ID}:4`,
      `cycle:${ITEM_ID}:3`,
      `transition:${ITEM_ID}:5`,
      `assignment:${ITEM_ID}:3`,
      `escalation:${ITEM_ID}:4`,
    ])
    expect(openings[0]?.detail).toMatchObject({ sourceRevision: 1 })
  })

  it('shows the eligibility_lost assignment with no next assignee and no acting user', async () => {
    await seedThreeCycleItem()
    const repo = createInboxHistoryRepository(db)

    const page = await repo.findByInboxItemId({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
    })
    const lost = page.entries.find(
      (entry) =>
        entry.detail.kind === 'assignment' && entry.detail.reason === 'eligibility_lost',
    )!

    expect(lost.actorUserId).toBeNull()
    expect(lost.detail).toMatchObject({
      reason: 'eligibility_lost',
      previousAssignee: ASSIGNEE_ID,
      nextAssignee: null,
    })
  })

  it('is tenant-fenced: the same item id under another Organization returns nothing', async () => {
    await seedThreeCycleItem()
    const repo = createInboxHistoryRepository(db)

    const page = await repo.findByInboxItemId({
      inboxItemId: ITEM_ID,
      organizationId: OTHER_ORG_ID,
    })

    expect(page).toEqual({ entries: [], truncated: false })
  })

  it('bounds every source query and reports truncation', async () => {
    await seedThreeCycleItem()
    const repo = createInboxHistoryRepository(db)

    const page = await repo.findByInboxItemId({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      limit: 2,
    })

    // Two cycles, two transitions, two assignments, one escalation.
    expect(page.entries).toHaveLength(7)
    expect(page.truncated).toBe(true)
  })
})
