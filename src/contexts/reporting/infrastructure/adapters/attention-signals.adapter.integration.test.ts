import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  seedCountReadings,
  seedGoalMonth,
  type SeedGoalMonthInput,
} from '../testing/goal-running-month-seed'
import { createAttentionSignalsAdapter } from './attention-signals.adapter'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORGANIZATION = organizationId(`org-attention-union-test-${randomUUID()}`)
const PROPERTY = propertyId(randomUUID())
const REVIEW_ONE = randomUUID()
const REVIEW_TWO = randomUUID()
let fixture: HeldTransaction | undefined
let client: HeldTransaction['client']
let db: Database

beforeAll(async () => {
  // Canonical Goal results are intentionally undeletable, so nothing here is
  // ever committed: the fixture is written inside the held transaction, on its
  // connection, and rolled back after the suite. The adapter reads through
  // `db`, so its statement-timeout transaction is a SAVEPOINT inside the held
  // one.
  fixture = await holdTransaction()
  client = fixture.client
  db = fixture.db
  await client.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Attention union test', $2, now())
     ON CONFLICT (id) DO NOTHING`,
    [ORGANIZATION, `attention-union-${randomUUID()}`],
  )
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Attention Property', 'attention-property', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORGANIZATION],
  )
})

beforeAll(async () => {
  for (const [id, externalId] of [
    [REVIEW_ONE, 'attention-review-one'],
    [REVIEW_TWO, 'attention-review-two'],
  ] as const) {
    await client.query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, rating, reviewed_at, expires_at, content_expires_at,
         source_epoch, source_revision, analysis_sequence,
         ai_source_byte_length, ai_source_digest
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/attention', 4,
         '2026-08-20T00:00:00Z', '2026-09-25T00:00:00Z',
         '2026-09-25T00:00:00Z', 0, 0, 0, 1, repeat('0', 64)
       )`,
      [id, ORGANIZATION, PROPERTY, externalId],
    )
  }

  for (const item of [
    {
      id: randomUUID(),
      sourceType: 'review',
      sourceId: REVIEW_ONE,
      status: 'open',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'open',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'closed',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'closed',
      escalated: false,
    },
  ] as const) {
    await client.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id,
         status, is_escalated, escalated_at, source_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-08-20T00:00:00Z')`,
      [
        item.id,
        ORGANIZATION,
        PROPERTY,
        item.sourceType,
        item.sourceId,
        item.status,
        item.escalated,
        item.escalated ? NOW : null,
      ],
    )
  }

  // An active scans goal with August 2026 running and one scan counted: at NOW
  // (day 25 of 31) it is far behind a target of 100.
  await seedGoalMonth(client, {
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    target: 100,
  })
  await seedCountReadings(client, {
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    count: 1,
    eventAt: '2026-08-20T00:00:00Z',
  })
})

afterAll(async () => {
  await fixture?.rollBack()
})

type RunningGoalMonth = Readonly<{
  versionTarget: number
  /** The month's own target; null when the month uses its version's. */
  monthTarget: number | null
  scansSoFar: number
}>

/** The goals behind pace of a Property that holds one goal, read at `now`. */
async function behindPaceAt(
  now: Date,
  scansSoFar: number,
  goal: Partial<SeedGoalMonthInput> = {},
): Promise<number> {
  const property = propertyId(randomUUID())
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1::uuid, $2, 'Pace Property', $1::text, 'UTC')`,
    [property, ORGANIZATION],
  )
  await seedGoalMonth(client, {
    organizationId: ORGANIZATION,
    propertyId: property,
    target: 100,
    ...goal,
  })
  await seedCountReadings(client, {
    organizationId: ORGANIZATION,
    propertyId: property,
    count: scansSoFar,
    eventAt: '2026-08-02T10:00:00Z',
    metric: goal.metric,
  })
  const counts = await createAttentionSignalsAdapter(db, () => now).getAttentionCounts(
    ORGANIZATION,
    property,
  )
  return counts.goalsBehindPace
}

// August 2026, day 25 of 31: the line expects 100 x 25 / 31 = 80.6 of a target of 100.
const LATE = NOW
// Day 4: the first day that is judged. Day 3 is not.
const FOURTH_DAY = new Date('2026-08-04T12:00:00.000Z')
const THIRD_DAY = new Date('2026-08-03T12:00:00.000Z')

describe('attention signal work-set union', () => {
  it('counts Dashboard-owned work anchors while leaving overdue targets to Inbox', async () => {
    const adapter = createAttentionSignalsAdapter(db, () => NOW)

    await expect(adapter.getAttentionCounts(ORGANIZATION, PROPERTY)).resolves.toEqual({
      overdue: 0,
      itemsToTriage: 2,
      escalated: 3,
      goalsBehindPace: 1,
      attentionWork: 4,
    })
  })
})

describe('goals behind pace, counted from the live month', () => {
  const behindPace = (month: RunningGoalMonth) =>
    behindPaceAt(LATE, month.scansSoFar, {
      target: month.versionTarget,
      monthTarget: month.monthTarget,
    })

  it('does not rest on the stored result, which a running month never fills', async () => {
    // The month row is `updating` with no value; the scans are the figure.
    await expect(behindPaceAt(LATE, 90)).resolves.toBe(0)
    await expect(behindPaceAt(LATE, 10)).resolves.toBe(1)
  })

  it('is on pace at 90% of the straight line and behind below it', async () => {
    // 100 x 25 / 31 = 80.64; 90% of it is 72.58.
    await expect(behindPaceAt(LATE, 73)).resolves.toBe(0)
    await expect(behindPaceAt(LATE, 72)).resolves.toBe(1)
  })

  it('does not flag the first three days of the month', async () => {
    await expect(behindPaceAt(THIRD_DAY, 0)).resolves.toBe(0)
    await expect(behindPaceAt(FOURTH_DAY, 0)).resolves.toBe(1)
  })

  it('never flags an average', async () => {
    await expect(
      behindPaceAt(LATE, 1, { metric: 'portal_rating_average', target: 4.5 }),
    ).resolves.toBe(0)
  })

  it('does not flag a paused goal', async () => {
    await expect(behindPaceAt(LATE, 1, { programStatus: 'paused' })).resolves.toBe(0)
  })

  it("is behind pace against the month's own higher target", async () => {
    // 90 scans keep pace with the version's 100, not with the month's own 400.
    await expect(
      behindPace({ versionTarget: 100, monthTarget: 400, scansSoFar: 90 }),
    ).resolves.toBe(1)
  })

  it("keeps pace against the month's own lower target", async () => {
    // 90 scans keep pace with the month's own 100, not with the version's 400.
    await expect(
      behindPace({ versionTarget: 400, monthTarget: 100, scansSoFar: 90 }),
    ).resolves.toBe(0)
  })

  it("uses the version's target for a month without its own", async () => {
    await expect(
      behindPace({ versionTarget: 400, monthTarget: null, scansSoFar: 90 }),
    ).resolves.toBe(1)
    await expect(
      behindPace({ versionTarget: 100, monthTarget: null, scansSoFar: 90 }),
    ).resolves.toBe(0)
  })

  it('counts a goal once however many of its subjects are behind', async () => {
    const property = propertyId(randomUUID())
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, 'Pace Property', $1::text, 'UTC')`,
      [property, ORGANIZATION],
    )
    const portals = [randomUUID(), randomUUID()]
    for (const portal of portals) {
      await client.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                              name, slug, publication_state, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Front desk', $1::text,
                 'published', now(), now())`,
        [portal, ORGANIZATION, property],
      )
    }
    const first = await seedGoalMonth(client, {
      organizationId: ORGANIZATION,
      propertyId: property,
      subject: { kind: 'portal', portalId: portals[0]! },
      target: 100,
    })
    await seedGoalMonth(client, {
      organizationId: ORGANIZATION,
      propertyId: property,
      subject: { kind: 'portal', portalId: portals[1]! },
      target: 100,
      program: { programId: first.programId, versionId: first.versionId },
    })

    const counts = await createAttentionSignalsAdapter(db, () => LATE).getAttentionCounts(
      ORGANIZATION,
      property,
    )

    // Both portals have counted nothing: one goal, two subjects behind.
    expect(counts.goalsBehindPace).toBe(1)
    expect(counts.attentionWork).toBe(1)
  })
})
