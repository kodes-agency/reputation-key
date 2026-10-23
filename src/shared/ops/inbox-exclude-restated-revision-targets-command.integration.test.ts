import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createRestatedRevisionExclusionPorts } from '#/composition/restated-revision-exclusion-ports'
import { createRestatedRevisionTargetExclusionStore } from '#/contexts/inbox/infrastructure/restated-revision-target-exclusion.store'
import { createRestatedRevisionQuery } from '#/contexts/review/infrastructure/repositories/restated-revision.repository'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  FALSE_REVISION_AT,
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  seedInboxItem,
  seedOrdinaryItem,
  seedRestatedRevisionItem,
  seedReview,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'
import { runInboxExcludeRestatedRevisionTargets } from './inbox-exclude-restated-revision-targets-command'

const ORG = 'org-exclusion-command-pg'
const PROPERTY = 'e8c70000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'e8c70000-0000-4000-8000-000000000002'
const OPEN_ITEM = 'e8c70000-0000-4000-8000-000000000101'
const LATE_ITEM = 'e8c70000-0000-4000-8000-000000000102'
const ON_TIME_ITEM = 'e8c70000-0000-4000-8000-000000000103'
const REAL_EDIT_ITEM = 'e8c70000-0000-4000-8000-000000000104'
const ORDINARY_ITEM = 'e8c70000-0000-4000-8000-000000000105'
const OTHER_PROPERTY_ITEM = 'e8c70000-0000-4000-8000-000000000106'
const reviewOf = (item: string) => `${item.slice(0, -4)}f${item.slice(-3)}`

const NOW = new Date('2026-10-24T09:00:00.000Z')
const LATER_EDIT = new Date('2026-10-23T07:00:00.000Z')

const db = getDb()
let pool: Pool

function ports() {
  return createRestatedRevisionExclusionPorts({
    inbox: createRestatedRevisionTargetExclusionStore(db),
    review: { list: createRestatedRevisionQuery(db).listRestatedRevisions },
    now: () => NOW,
  })
}

async function run(options: { apply: boolean; property?: string; ticket?: string }) {
  const lines: string[] = []
  const errors: string[] = []
  const exitCode = await runInboxExcludeRestatedRevisionTargets({
    ctx: {
      dryRun: !options.apply,
      operatorId: 'operator-pg',
      correlationId: randomUUID(),
      reason: options.apply ? 'Google restated the reviews' : undefined,
      ticket: options.ticket,
    },
    propertyId: options.property ?? PROPERTY,
    ports: ports(),
    io: { out: (line) => lines.push(line), err: (line) => errors.push(line) },
  })
  return {
    exitCode,
    report: JSON.parse(lines[0] ?? '{}') as Record<string, unknown>,
    errors,
  }
}

const ledgerRows = async () =>
  (
    await pool.query<{ inbox_item_id: string }>(
      `SELECT inbox_item_id FROM inbox_response_target_exclusions
        WHERE organization_id = $1 ORDER BY inbox_item_id`,
      [ORG],
    )
  ).rows.map((row) => row.inbox_item_id)

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'exclusion-command-pg',
    at: GUEST_UPDATE_TIME,
    properties: [
      { id: PROPERTY, name: 'Command Property', slug: 'command-property' },
      { id: OTHER_PROPERTY, name: 'Other Property', slug: 'other-property' },
    ],
  })
  const restated = [
    [OPEN_ITEM, PROPERTY, 'open'],
    [LATE_ITEM, PROPERTY, 'late'],
    [ON_TIME_ITEM, PROPERTY, 'on_time'],
    [OTHER_PROPERTY_ITEM, OTHER_PROPERTY, 'open'],
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
  // A real edit: revision 2 exists because Google's updateTime moved.
  await seedReview(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: reviewOf(REAL_EDIT_ITEM),
    createdAt: GUEST_UPDATE_TIME,
    revisions: [
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
      { revision: 2, eligibility: 'measured', startAt: LATER_EDIT },
    ],
    observations: [
      {
        sequence: 1,
        materialRevision: 1,
        comparison: 'initial_material_revision',
        sourceUpdatedAt: GUEST_UPDATE_TIME,
        observedAt: GUEST_UPDATE_TIME,
      },
      {
        sequence: 2,
        materialRevision: 2,
        comparison: 'material_change',
        sourceUpdatedAt: LATER_EDIT,
        observedAt: FALSE_REVISION_AT,
      },
    ],
  })
  await seedInboxItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: reviewOf(REAL_EDIT_ITEM),
    itemId: REAL_EDIT_ITEM,
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
        target: { eligibility: 'measured', startAt: LATER_EDIT },
      },
    ],
  })
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: reviewOf(ORDINARY_ITEM),
    itemId: ORDINARY_ITEM,
    startAt: new Date('2026-10-18T09:00:00.000Z'),
    outcome: 'open',
  })
})

describe.sequential('ops inbox exclude-restated-revision-targets (PostgreSQL)', () => {
  it('lists exactly the cycles a restated revision opened, and writes nothing on a dry run', async () => {
    const { exitCode, report } = await run({ apply: false })

    expect(exitCode).toBe(0)
    expect(report).toMatchObject({
      outcome: 'would_exclude',
      organizationId: ORG,
      propertyId: PROPERTY,
      restatedRevisions: 3,
      candidates: 3,
      byItemStatus: { open: 1, closed: 2 },
      byTargetState: { open: 1, on_time: 1, late: 1, cancelled: 0 },
      pendingReminderSlots: 1,
      candidateIds: [
        { inboxItemId: OPEN_ITEM, cycleNumber: 2 },
        { inboxItemId: LATE_ITEM, cycleNumber: 2 },
        { inboxItemId: ON_TIME_ITEM, cycleNumber: 2 },
      ],
    })
    expect(await ledgerRows()).toEqual([])
    const slot = await pool.query(
      `SELECT 1 FROM inbox_response_target_reminders
        WHERE inbox_item_id = $1 AND organization_id = $2 AND cancelled_at IS NOT NULL`,
      [OPEN_ITEM, ORG],
    )
    expect(slot.rowCount).toBe(0)
  })

  it('writes the rows and cancels the pending slot on apply, and a second apply is a no-op', async () => {
    const first = await run({ apply: true, ticket: 'OPS-70' })
    const afterFirst = await ledgerRows()
    const second = await run({ apply: true, ticket: 'OPS-70' })

    expect(first.exitCode).toBe(0)
    expect(first.report).toMatchObject({
      outcome: 'excluded',
      operator: 'operator-pg',
      ticket: 'OPS-70',
      results: { excluded: 3, already_excluded: 0 },
      cancelledReminderSlots: 1,
    })
    expect(afterFirst).toEqual([OPEN_ITEM, LATE_ITEM, ON_TIME_ITEM].sort())
    expect(second.exitCode).toBe(0)
    expect(second.report).toMatchObject({ outcome: 'nothing_to_exclude', candidates: 0 })
    expect(await ledgerRows()).toEqual(afterFirst)
    const ledger = await pool.query(
      `SELECT DISTINCT operator_id, ticket, reason FROM inbox_response_target_exclusions
        WHERE organization_id = $1`,
      [ORG],
    )
    expect(ledger.rows).toEqual([
      { operator_id: 'operator-pg', ticket: 'OPS-70', reason: 'provider_restatement' },
    ])
  })

  it('leaves the other Property, the real edit and the ordinary item alone', async () => {
    await run({ apply: true })

    expect(await ledgerRows()).not.toContain(OTHER_PROPERTY_ITEM)
    expect(await ledgerRows()).not.toContain(REAL_EDIT_ITEM)
    expect(await ledgerRows()).not.toContain(ORDINARY_ITEM)
  })

  it('refuses a Property that does not exist', async () => {
    const { exitCode, report, errors } = await run({
      apply: true,
      property: 'e8c70000-0000-4000-8000-0000000000ff',
    })

    expect(exitCode).toBe(1)
    expect(report).toEqual({ outcome: 'property_not_found' })
    expect(errors[0]).toContain('no Property has that id')
    expect(await ledgerRows()).toEqual([])
  })
})
