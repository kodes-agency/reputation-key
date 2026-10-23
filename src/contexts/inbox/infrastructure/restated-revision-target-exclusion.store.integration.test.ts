import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  FALSE_REVISION_AT,
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  excludeCycle,
  seedInboxItem,
  seedOrdinaryItem,
  seedRestatedRevisionItem,
  seedReview,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'
import { createRestatedRevisionTargetExclusionStore } from './restated-revision-target-exclusion.store'

const ORG = organizationId('org-restated-target-exclusion')
const PROPERTY = propertyId('e8c60000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('e8c60000-0000-4000-8000-000000000002')

const OPEN_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000101')
const LATE_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000102')
const ON_TIME_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000103')
const REAL_EDIT_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000104')
const ORDINARY_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000105')
const OTHER_PROPERTY_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000106')
const ALREADY_EXCLUDED_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000107')
const UNMEASURED_ITEM = inboxItemId('e8c60000-0000-4000-8000-000000000108')

/** A Review id of its own for each item: the last group's fourth-from-last digit becomes `f`. */
const reviewOf = (item: string) => `${item.slice(0, -4)}f${item.slice(-3)}`

const NOW = new Date('2026-10-24T09:00:00.000Z')
const AUDIT = {
  operatorId: 'operator-exclusions',
  ticket: 'OPS-70',
  correlationId: '9d1b6a52-4c4e-4f4e-8a0a-0a52f2a4d701',
  at: NOW,
}

const db = getDb()
let pool: Pool

const store = () => createRestatedRevisionTargetExclusionStore(db)
const scope = { organizationId: ORG, propertyId: PROPERTY }

/** What Review reports for the restated Reviews of this Property. */
const restatedRefs = (items: ReadonlyArray<string>) =>
  items.map((item) => ({ reviewId: reviewOf(item), revision: 2 }))

async function snapshot(table: string): Promise<ReadonlyArray<unknown>> {
  const rows = await pool.query<{ row: unknown }>(
    // `table` is a literal of this file, never input.
    `SELECT to_jsonb(t) AS row FROM ${table} t WHERE organization_id = $1 ORDER BY 1`,
    [ORG],
  )
  return rows.rows.map((row) => row.row)
}

async function seedWorld(): Promise<void> {
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'restated-target-exclusion',
    at: GUEST_UPDATE_TIME,
    properties: [
      { id: PROPERTY, name: 'Exclusion Property', slug: 'exclusion-property' },
      { id: OTHER_PROPERTY, name: 'Other Property', slug: 'other-property' },
    ],
  })
  const restated = [
    [OPEN_ITEM, PROPERTY, 'open'],
    [LATE_ITEM, PROPERTY, 'late'],
    [ON_TIME_ITEM, PROPERTY, 'on_time'],
    [REAL_EDIT_ITEM, PROPERTY, 'open'],
    [OTHER_PROPERTY_ITEM, OTHER_PROPERTY, 'open'],
    [ALREADY_EXCLUDED_ITEM, PROPERTY, 'late'],
  ] as const
  for (const [item, property, outcome] of restated) {
    await seedRestatedRevisionItem(pool, {
      organizationId: ORG,
      propertyId: property,
      reviewId: reviewOf(item),
      itemId: item,
      outcome,
      targetPassedPending: item === OPEN_ITEM,
    })
  }
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: reviewOf(ORDINARY_ITEM),
    itemId: ORDINARY_ITEM,
    startAt: new Date('2026-10-18T09:00:00.000Z'),
    outcome: 'open',
  })
  await excludeCycle(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    itemId: ALREADY_EXCLUDED_ITEM,
    cycleNumber: 2,
  })
}

const everyRestated = [
  OPEN_ITEM,
  LATE_ITEM,
  ON_TIME_ITEM,
  ALREADY_EXCLUDED_ITEM,
  OTHER_PROPERTY_ITEM,
]

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedWorld()
})

describe.sequential('Restated revision target exclusions (PostgreSQL)', () => {
  it('finds the Organization that owns a Property, and nothing for an unknown one', async () => {
    await expect(store().findProperty(PROPERTY)).resolves.toEqual({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    await expect(
      store().findProperty('e8c60000-0000-4000-8000-0000000000ff'),
    ).resolves.toBeNull()
  })

  it('lists exactly the unexcluded measured Google cycles opened on a restated revision of the Property', async () => {
    const scan = await store().scan({ scope, restated: restatedRefs(everyRestated) })

    expect(
      scan.candidates.map((c) => [c.inboxItemId, c.cycleNumber, c.revision]),
    ).toEqual([OPEN_ITEM, LATE_ITEM, ON_TIME_ITEM].sort().map((id) => [id, 2, 2]))
    const byItem = new Map(scan.candidates.map((c) => [c.inboxItemId, c]))
    expect(byItem.get(OPEN_ITEM)).toMatchObject({
      itemStatus: 'open',
      targetState: 'open',
      pendingReminderSlots: 1,
    })
    expect(byItem.get(LATE_ITEM)).toMatchObject({
      itemStatus: 'closed',
      targetState: 'late',
      pendingReminderSlots: 0,
    })
    expect(byItem.get(ON_TIME_ITEM)).toMatchObject({
      itemStatus: 'closed',
      targetState: 'on_time',
    })
  })

  it('writes nothing when it only looks', async () => {
    const before = await Promise.all(
      ['inbox_response_target_exclusions', 'inbox_response_target_reminders'].map(
        snapshot,
      ),
    )

    await store().scan({ scope, restated: restatedRefs(everyRestated) })

    expect(
      await Promise.all(
        ['inbox_response_target_exclusions', 'inbox_response_target_reminders'].map(
          snapshot,
        ),
      ),
    ).toEqual(before)
  })

  it('records the exclusions with the operator trail, cancels the pending slot and changes nothing else', async () => {
    const { candidates } = await store().scan({
      scope,
      restated: restatedRefs(everyRestated),
    })
    const untouched = [
      'inbox_items',
      'inbox_handling_cycle_heads',
      'inbox_handling_cycles',
      'inbox_handling_cycle_response_targets',
    ]
    const before = await Promise.all(untouched.map(snapshot))

    const results = await store().apply({ scope, candidates, audit: AUDIT })

    expect(results.map((r) => r.outcome)).toEqual(['excluded', 'excluded', 'excluded'])
    expect(await Promise.all(untouched.map(snapshot))).toEqual(before)
    const ledger = await pool.query(
      `SELECT inbox_item_id, operator_id, ticket, correlation_id, recorded_at, reason
         FROM inbox_response_target_exclusions
        WHERE organization_id = $1 AND inbox_item_id <> $2
        ORDER BY inbox_item_id`,
      [ORG, ALREADY_EXCLUDED_ITEM],
    )
    expect(ledger.rows).toEqual(
      [OPEN_ITEM, LATE_ITEM, ON_TIME_ITEM].sort().map((id) => ({
        inbox_item_id: id,
        operator_id: 'operator-exclusions',
        ticket: 'OPS-70',
        correlation_id: AUDIT.correlationId,
        recorded_at: NOW,
        reason: 'provider_restatement',
      })),
    )
    const slot = await pool.query<{
      cancelled_at: Date | null
      delivered_at: Date | null
    }>(
      `SELECT cancelled_at, delivered_at FROM inbox_response_target_reminders
        WHERE inbox_item_id = $1 AND cycle_number = 2 AND organization_id = $2`,
      [OPEN_ITEM, ORG],
    )
    expect(slot.rows).toEqual([{ cancelled_at: NOW, delivered_at: null }])
    expect(results.find((r) => r.inboxItemId === OPEN_ITEM)?.cancelledReminderSlots).toBe(
      1,
    )
  })

  it('does nothing the second time', async () => {
    const { candidates } = await store().scan({
      scope,
      restated: restatedRefs(everyRestated),
    })
    await store().apply({ scope, candidates, audit: AUDIT })
    const afterFirst = await snapshot('inbox_response_target_exclusions')

    const second = await store().apply({
      scope,
      candidates,
      audit: { ...AUDIT, operatorId: 'someone-else', correlationId: randomUUID() },
    })
    const rescan = await store().scan({ scope, restated: restatedRefs(everyRestated) })

    expect(second.map((r) => r.outcome)).toEqual([
      'already_excluded',
      'already_excluded',
      'already_excluded',
    ])
    expect(second.every((r) => r.cancelledReminderSlots === 0)).toBe(true)
    expect(await snapshot('inbox_response_target_exclusions')).toEqual(afterFirst)
    expect(rescan.candidates).toEqual([])
  })

  it('refuses a candidate whose cycle is no longer the one recorded for that revision', async () => {
    const [candidate] = (
      await store().scan({ scope, restated: restatedRefs([OPEN_ITEM]) })
    ).candidates
    if (!candidate) throw new Error('fixture has no candidate')

    const results = await store().apply({
      scope,
      candidates: [
        { ...candidate, revision: 3 },
        { ...candidate, cycleNumber: 1, revision: 1 },
        { ...candidate, reviewId: reviewOf(LATE_ITEM) },
      ],
      audit: AUDIT,
    })

    expect(results.map((r) => r.outcome)).toEqual([
      'refused_cycle_changed',
      'refused_cycle_changed',
      'refused_cycle_changed',
    ])
    const written = await pool.query(
      `SELECT 1 FROM inbox_response_target_exclusions
        WHERE inbox_item_id = $1 AND organization_id = $2`,
      [OPEN_ITEM, ORG],
    )
    expect(written.rowCount).toBe(0)
  })

  it('refuses a candidate of another Property', async () => {
    const [candidate] = (
      await store().scan({
        scope: { organizationId: ORG, propertyId: OTHER_PROPERTY },
        restated: restatedRefs([OTHER_PROPERTY_ITEM]),
      })
    ).candidates
    if (!candidate) throw new Error('fixture has no candidate')

    const results = await store().apply({ scope, candidates: [candidate], audit: AUDIT })

    expect(results.map((r) => r.outcome)).toEqual(['refused_cycle_changed'])
  })

  it('refuses a candidate whose cycle holds no measured Google target', async () => {
    await seedReview(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: reviewOf(UNMEASURED_ITEM),
      createdAt: GUEST_UPDATE_TIME,
      revisions: [
        { revision: 1, eligibility: 'historical_onboarding', startAt: null },
        { revision: 2, eligibility: 'historical_onboarding', startAt: null },
      ],
    })
    await seedInboxItem(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: reviewOf(UNMEASURED_ITEM),
      itemId: UNMEASURED_ITEM,
      status: 'open',
      createdAt: GUEST_UPDATE_TIME,
      cycles: [
        {
          number: 1,
          revision: 1,
          openedReason: 'review_observed',
          openedAt: GUEST_UPDATE_TIME,
          target: { eligibility: 'historical_onboarding', startAt: null },
        },
        {
          number: 2,
          revision: 2,
          openedReason: 'material_revision_changed',
          openedAt: FALSE_REVISION_AT,
          target: { eligibility: 'historical_onboarding', startAt: null },
        },
      ],
    })

    const scan = await store().scan({ scope, restated: restatedRefs([UNMEASURED_ITEM]) })
    const results = await store().apply({
      scope,
      candidates: [
        {
          inboxItemId: UNMEASURED_ITEM,
          cycleNumber: 2,
          reviewId: reviewOf(UNMEASURED_ITEM),
          revision: 2,
          itemStatus: 'open',
          targetState: 'open',
          pendingReminderSlots: 0,
        },
      ],
      audit: AUDIT,
    })

    expect(scan.candidates).toEqual([])
    expect(results.map((r) => r.outcome)).toEqual(['refused_target_not_measured'])
  })
})
