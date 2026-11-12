// An Organization closure journals one entry per context, and those contexts'
// rows reference each other through blocking foreign keys: guest responses and
// metric readings name a Staff participation and a Portal, a participation
// names its personal Portal, a responsibility names both. The export lists
// entries by id, which is a hash, so restore replay must not depend on that
// order. This proves, against real PostgreSQL, that a restore holding every
// row the closure erased replays cleanly whatever order the export lists.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetEnv, getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureLedgerEntry,
  type BackupErasureReplayer,
  type RestoreResurrectionFenceResult,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import {
  holdRightsOrganization,
  recordingJournalStore,
  rightsPlan,
  RIGHTS_FIXTURE_AT,
} from '#/shared/db/testing/rights-isolation-fixture'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  rightsJournalEntry,
} from '#/shared/ops/rights/rights-journal'
import type { Tx } from '#/shared/outbox/commit'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { composeRightsExecutors, composeRightsReplayers } from './rights-executors'

const RESTORE_POINT = new Date(RIGHTS_FIXTURE_AT.getTime() - 86_400_000)
const STAFF_FROM = new Date(RIGHTS_FIXTURE_AT.getTime() - 3_600_000)

/** Contexts whose rows hold each other's foreign keys in this fixture. */
const LINKED_CONTEXTS = ['guest', 'metric', 'portal', 'staff'] as const

/** Every row the fixture seeds, by table, so a replay can be checked complete. */
const SEEDED_TABLES = [
  'guest_responses',
  'metric_readings',
  'portal_responsibilities',
  'staff_participations',
  'staff_participants',
  'portals',
] as const

class RolledBack extends Error {}

let lease: TestLease
let db: Database
const organizations: string[] = []
const q = (text: string, params: unknown[] = []) => lease.pool.query(text, params)

type Closed = Readonly<{ organizationId: string; propertyId: string }>

async function seedClosedOrganization(): Promise<Closed> {
  const organizationId = `closure-order-${randomUUID()}`
  const propertyId = randomUUID()
  const portalId = randomUUID()
  const personalPortalId = randomUUID()
  const participantId = randomUUID()
  const participationId = randomUUID()
  const responsibilityId = randomUUID()
  organizations.push(organizationId)
  const at = RIGHTS_FIXTURE_AT
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Closure', $1, $2)`,
    [organizationId, at],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Closure Property', $1::text, 'UTC', $3, $3)`,
    [propertyId, organizationId, at],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, publication_state)
     VALUES ($1::uuid, $2, $3::uuid, $3::text, 'Front Desk', $1::text, 'published')`,
    [portalId, organizationId, propertyId],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, kind, public_name)
     VALUES ($1::uuid, $2, $3::uuid, $3::text, 'Polly', $1::text, 'personal', 'Closure')`,
    [personalPortalId, organizationId, propertyId],
  )
  await q(
    `INSERT INTO staff_participants (id, organization_id, display_name, created_by)
     VALUES ($1, $2, 'Polly', 'seed')`,
    [participantId, organizationId],
  )
  await q(
    `INSERT INTO staff_participations (id, organization_id, property_id, staff_participant_id,
       personal_portal_id, display_name, started_at, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Polly', $6, 'seed')`,
    [
      participationId,
      organizationId,
      propertyId,
      participantId,
      personalPortalId,
      STAFF_FROM,
    ],
  )
  await q(
    `INSERT INTO portal_responsibilities (id, organization_id, property_id, portal_id,
       staff_participation_id, kind, effective_from, created_by)
     VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'primary', $6, 'seed')`,
    [responsibilityId, organizationId, propertyId, portalId, participationId, STAFF_FROM],
  )
  const attribution = [participantId, participationId, responsibilityId, STAFF_FROM]
  await q(
    `INSERT INTO guest_responses (
       id, organization_id, property_id, portal_id, status, rating, response_consent,
       text_consent, private_feedback_threshold, correction_count, submitted_at,
       retention_deadline, attributed_staff_participant_id,
       attributed_staff_participation_id, attribution_responsibility_id,
       staff_attribution_effective_from, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'submitted', 4, true, false, 3, 0, $5,
               $5::timestamptz + interval '700 days', $6, $7, $8, $9, $5, $5)`,
    [randomUUID(), organizationId, propertyId, portalId, at, ...attribution],
  )
  await q(
    `INSERT INTO metric_readings (
       organization_id, property_id, portal_id, metric_key, value, recorded_at,
       attributed_staff_participant_id, attributed_staff_participation_id,
       attribution_responsibility_id, staff_attribution_effective_from
     ) VALUES ($1, $2, $3, 'portal.rating', 4, $4, $5, $6, $7, $8)`,
    [organizationId, propertyId, portalId, at, ...attribution],
  )
  return { organizationId, propertyId }
}

/** The entries the closure writes before it deletes, with the rows still in place. */
async function journalClosure(closed: Closed): Promise<BackupErasureLedgerEntry[]> {
  holdRightsOrganization(closed.organizationId)
  const recorder = recordingJournalStore()
  // Apply is withheld, so the database stays as a restore to before the
  // closure would bring it back; the journal bytes depend only on the plan and
  // the executor order. Preflight is withheld too: the Portal probe runs its
  // deletes before the executors ahead of it have erased what references them.
  const executors = composeRightsExecutors(
    {
      db,
      journal: createRightsJournal(undefined),
      runNotification: vi.fn(),
      portalObjectStore: { deleteObject: async () => {} },
    },
    false,
  ).map(({ preflight: _preflight, ...executor }) => ({
    ...executor,
    apply: async () => ({ ok: true as const, lines: [] }),
  }))
  const err: string[] = []
  const code = await runRightsExecutors({
    plan: rightsPlan('organization', closed.organizationId),
    executors,
    journal: createRightsJournal(recorder.store),
    io: { out: () => {}, err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  expect(err).toEqual([])
  expect(code).toBe(0)
  return [...recorder.entries()].sort((a, b) => a.id.localeCompare(b.id))
}

async function seededCounts(executor: Tx | Database, organizationId: string) {
  const counts: Record<string, number> = {}
  for (const table of SEEDED_TABLES) {
    const result = await executor.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
    )
    counts[table] = (result.rows[0] as { n: number }).n
  }
  return counts
}

const NONE = Object.fromEntries(SEEDED_TABLES.map((table) => [table, 0]))

function replayers(): readonly BackupErasureReplayer[] {
  return composeRightsReplayers({
    db,
    now: () => RIGHTS_FIXTURE_AT,
    notificationReplayers: createNotificationRightsReplayers(),
  })
}

/** Runs `work` in a transaction that never commits, so every case starts restored. */
async function rolledBack<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined
  await db
    .transaction(async (tx) => {
      result = await work(tx)
      throw new RolledBack()
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error
    })
  return result as T
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  )
}

/** The export with the linked entries moved among their own slots. */
function exportOrders(
  entries: readonly BackupErasureLedgerEntry[],
): BackupErasureLedgerEntry[][] {
  const linked = new Set<string>(LINKED_CONTEXTS)
  const slots = entries.flatMap((entry, index) =>
    linked.has(entry.context) ? [index] : [],
  )
  const orders = permutations(slots.map((slot) => entries[slot]!)).map((arranged) => {
    const order = [...entries]
    slots.forEach((slot, index) => {
      order[slot] = arranged[index]!
    })
    return order
  })
  return [...orders, ...orders.map((order) => [...order].reverse())]
}

describe('closure restore replay order', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    vi.unstubAllEnvs()
    resetEnv()
    for (const organizationId of organizations) {
      for (const table of [...SEEDED_TABLES, 'properties']) {
        await q(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId])
      }
    }
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
  })

  it('replays a closure cleanly in every order the export can list it', async () => {
    const closed = await seedClosedOrganization()
    const entries = await journalClosure(closed)
    expect(entries.map(({ context }) => context)).toEqual(
      expect.arrayContaining([...LINKED_CONTEXTS]),
    )
    expect(new Set(entries.map((entry) => entry.applyOrder?.planId)).size).toBe(1)
    expect(await seededCounts(db, closed.organizationId)).not.toEqual(NONE)

    const orders = exportOrders(entries)
    expect(orders).toHaveLength(48)
    for (const order of orders) {
      const outcome: RestoreResurrectionFenceResult & { left: Record<string, number> } =
        await rolledBack(async (tx) => {
          const fence = await applyRestoreResurrectionFence(tx, {
            entries: order,
            restorePointAt: RESTORE_POINT,
            replayers: replayers(),
          })
          return { ...fence, left: await seededCounts(tx, closed.organizationId) }
        })
      expect(outcome.verified).toBe(true)
      expect(outcome.counts.ledgerEntriesReapplied).toBe(entries.length)
      expect(outcome.left).toEqual(NONE)
    }
  })

  it('fails when the same entries are replayed in the order the export lists them', async () => {
    // Without apply order, Staff can go before the Guest and Reporting rows
    // that reference it, and the replay throws on a foreign key.
    const closed = await seedClosedOrganization()
    const entries = await journalClosure(closed)
    const staffFirst = [
      ...entries.filter(({ context }) => context === 'staff'),
      ...entries.filter(({ context }) => context !== 'staff'),
    ]
    const registry = replayers()
    await expect(
      rolledBack(async (tx) => {
        for (const entry of staffFirst) {
          const replayer = registry.find(
            (candidate) =>
              candidate.context === entry.context &&
              candidate.subjectClass === entry.subjectClass &&
              candidate.targetKind === entry.journalTargets?.kind,
          )
          await replayer!.reErase(tx, entry)
        }
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } })
  })

  it('still replays an entry written without an apply order', async () => {
    const closed = await seedClosedOrganization()
    const single = rightsJournalEntry(
      rightsPlan('organization', closed.organizationId),
      'guest',
    )
    if ('error' in single) throw new Error(single.error)
    expect(single.applyOrder).toBeUndefined()

    const outcome = await rolledBack(async (tx) => {
      const fence = await applyRestoreResurrectionFence(tx, {
        entries: [single],
        restorePointAt: RESTORE_POINT,
        replayers: replayers(),
      })
      return { ...fence, left: await seededCounts(tx, closed.organizationId) }
    })
    expect(outcome.verified).toBe(true)
    expect(outcome.counts.ledgerEntriesReapplied).toBe(1)
    expect(outcome.left.guest_responses).toBe(0)
    expect(outcome.left.staff_participations).toBe(1)
  })
})
