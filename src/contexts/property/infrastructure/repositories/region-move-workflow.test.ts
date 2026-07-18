// BQC-4.5 — region move rehearsal (real PostgreSQL + real Redis).
//
// The synthetic proof that the move machine works end to end while beta has
// ONE approved cell ('us' — ADR 0048):
//   (a) full lifecycle against a STUBBED approved target ('europe' injected
//       into the use-case dep): requested → … → completed; the property's
//       region swaps exactly once; ONE region_moves row carries the history.
//   (b) crash/retry: the stepper is idempotent per step.
//   (c) rollback: failed at queues_drained → rolling_back → rolled_back; the
//       source stays authoritative throughout; queues resume (jobs preserved).
//   (d) a country edit during an active move → region_locked, no new row; and
//       with NO active move a cross-region edit → region_locked + zero rows.
//   (e) a real request with NO approved target → typed denial + operator
//       audit, no row.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Queue } from 'bullmq'
import { getDb } from '#/shared/db'
import { createJobQueue } from '#/shared/jobs/queue'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { organizationId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createRegionMoveRepository } from './region-move.repository'
import { requestRegionMove } from '../../application/use-cases/request-region-move'
import { advanceRegionMove } from '../../application/use-cases/advance-region-move'
import { updateProperty } from '../../application/use-cases/update-property'
import { createAtomicPropertyCommandStore } from '../property-command-store'
import { createPropertyRepository } from './property.repository'
import { isPropertyError } from '../../domain/errors'
import {
  authoritativeCellFor,
  type RegionMoveState,
} from '../../domain/region-move-workflow'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const ORG = 'org-region-move'
const OPERATOR = 'user-region-move-op'
const PROP_LIFECYCLE = 'd5000000-0000-4000-8000-0000000000a1'
const PROP_RETRY = 'd5000000-0000-4000-8000-0000000000a2'
const PROP_ROLLBACK = 'd5000000-0000-4000-8000-0000000000a3'
const PROP_LOCKED = 'd5000000-0000-4000-8000-0000000000a4'
const PROP_NO_MOVE = 'd5000000-0000-4000-8000-0000000000a5'
const PROP_DENIED = 'd5000000-0000-4000-8000-0000000000a6'
const PROP_PAUSE = 'd5000000-0000-4000-8000-0000000000a7'

const T0 = new Date('2026-07-18T12:00:00.000Z')

const db = getDb()
const ctx = buildTestAuthContext({
  role: 'AccountAdmin',
  organizationId: organizationId(ORG),
  userId: userId(OPERATOR),
})

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const stubStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

let defaultQueue: Queue
let backgroundQueue: Queue
let now = T0
const tick = (ms: number) => {
  now = new Date(now.getTime() + ms)
}

const store = createRegionMoveRepository(db)
const audits: Array<Record<string, unknown>> = []
let moveSeq = 0

function makeUseCases(approvedCells: ReadonlySet<string>) {
  const request = requestRegionMove({
    propertyRepo: createPropertyRepository(db),
    moveStore: store,
    approvedCells,
    writeOperatorAudit: async (entry) => {
      audits.push(entry)
      await db.execute(sql`
        INSERT INTO policy_decision_audit
          (actor_type, actor_id, organization_id, property_id, action, capability,
           execution_kind, decision, reason, policy_version, correlation_id)
        VALUES ('operator', ${entry.actorUserId}, ${entry.organizationId}, ${entry.propertyId},
                ${entry.action}, NULL, 'operator', ${entry.decision}, ${entry.reason}, 'test', NULL)
      `)
    },
    idGen: () => `d5000000-0000-4000-8000-${String(++moveSeq).padStart(12, '0')}`,
    clock: () => now,
  })
  const advance = advanceRegionMove({
    moveStore: store,
    queues: [
      { name: 'default', queue: defaultQueue },
      { name: 'background', queue: backgroundQueue },
    ],
    clock: () => now,
  })
  const update = updateProperty({
    propertyRepo: createPropertyRepository(db),
    staffPublicApi: stubStaffApi,
    commandStore: createAtomicPropertyCommandStore(db, silentEvents),
    clock: () => now,
    hasActiveRegionMove: async (orgId, pid) =>
      (await store.findActiveMoveForProperty(orgId, pid)) !== null,
  })
  return { request, advance, update }
}

// The simulated approved target: 'europe' is injected as approved — the real
// beta set ({'us'}) denies every move (proven in the denial test below).
const stubbed = () => makeUseCases(new Set(['us', 'europe']))

async function seedProperty(id: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties
      (id, organization_id, name, slug, timezone, country_code, country_source,
       processing_region, processing_region_source, routing_policy_version,
       processing_region_resolved_at)
    VALUES (${id}, ${ORG}, ${'move-prop-' + id.slice(-2)}, ${'move-prop-' + id.slice(-2)},
            'UTC', 'US', 'manual', 'us', 'country_default', 1, now())
  `)
}

async function propertyRegion(
  id: string,
): Promise<{ region: string | null; version: number; source: string | null }> {
  const rows = await db.execute(
    sql`SELECT processing_region, routing_policy_version, processing_region_source
        FROM properties WHERE id = ${id}`,
  )
  const row = rows.rows[0] as Record<string, unknown> | undefined
  return {
    region: (row?.processing_region as string | null) ?? null,
    version: row?.routing_policy_version as number,
    source: (row?.processing_region_source as string | null) ?? null,
  }
}

async function moveRowsFor(propertyId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.execute(
    sql`SELECT * FROM region_moves WHERE property_id = ${propertyId} ORDER BY requested_at, id`,
  )
  return rows.rows as Array<Record<string, unknown>>
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const dq = createJobQueue('default')
  const bq = createJobQueue('background')
  if (!dq || !bq) throw new Error('REDIS_URL required for the move rehearsal')
  defaultQueue = dq
  backgroundQueue = bq
  // Scratch queues: guarantee an empty drain baseline (test-local Redis).
  await defaultQueue.obliterate({ force: true })
  await backgroundQueue.obliterate({ force: true })

  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM region_moves WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${OPERATOR}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)

  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Region Move Org', ${ORG}, now())`,
  )
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES (${OPERATOR}, 'Move Operator', 'user-region-move-op@example.com', true, now(), now())`,
  )
  await db.execute(
    sql`INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
        VALUES ('m-region-move-1', ${OPERATOR}, ${ORG}, 'owner', now())`,
  )
  for (const id of [
    PROP_LIFECYCLE,
    PROP_RETRY,
    PROP_ROLLBACK,
    PROP_LOCKED,
    PROP_NO_MOVE,
    PROP_DENIED,
    PROP_PAUSE,
  ]) {
    await seedProperty(id)
  }
})

afterAll(async () => {
  await defaultQueue.resume()
  await backgroundQueue.resume()
  await defaultQueue.obliterate({ force: true })
  await backgroundQueue.obliterate({ force: true })
  await defaultQueue.close()
  await backgroundQueue.close()
  clearEventSchemas()
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM region_moves WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${OPERATOR}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

beforeEach(async () => {
  now = T0
  audits.length = 0
  await defaultQueue.resume()
  await backgroundQueue.resume()
})

describe('region move rehearsal (BQC-4.5, real PostgreSQL + Redis)', () => {
  it('(a) full lifecycle: requested → … → completed with exactly one authority swap', async () => {
    const { request, advance } = stubbed()

    const requested = await request(
      { propertyId: PROP_LIFECYCLE, toRegion: 'europe', reason: 'rehearsal move' },
      ctx,
    )
    expect(requested.ok).toBe(true)
    if (!requested.ok) return
    const moveId = requested.move.id

    const observed: Array<{
      state: RegionMoveState
      region: string | null
      version: number
    }> = []
    observed.push({ state: 'requested', ...(await propertyRegion(PROP_LIFECYCLE)) })
    const stateChangedTicks: Date[] = [requested.move.stateChangedAt]

    const path: ReadonlyArray<RegionMoveState> = [
      'writes_paused',
      'queues_drained',
      'data_copied',
      'verified',
      'target_activated',
      'source_erased',
      'completed',
    ]
    for (const toState of path) {
      tick(60_000)
      const result = await advance({ moveId, toState, confirmedBy: OPERATOR }, ctx)
      expect(result.advanced).toBe(true)
      observed.push({
        state: result.move.state,
        ...(await propertyRegion(PROP_LIFECYCLE)),
      })
      stateChangedTicks.push(result.move.stateChangedAt)
    }

    // The region swapped exactly once, at target_activated.
    expect(observed.map((o) => `${o.state}:${o.region}@v${o.version}`)).toEqual([
      'requested:us@v1',
      'writes_paused:us@v1',
      'queues_drained:us@v1',
      'data_copied:us@v1',
      'verified:us@v1',
      'target_activated:europe@v2',
      'source_erased:europe@v2',
      'completed:europe@v2',
    ])

    // ONE row carries the full history; state_changed_at advanced every step.
    const rows = await moveRowsFor(PROP_LIFECYCLE)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('completed')
    const asTime = (v: unknown) => new Date(v as string).getTime()
    expect(asTime(rows[0].requested_at)).toBe(T0.getTime())
    expect(asTime(rows[0].state_changed_at)).toBe(stateChangedTicks.at(-1)?.getTime())
    expect(asTime(rows[0].completed_at)).toBe(stateChangedTicks.at(-1)?.getTime())
    expect(rows[0].requested_by).toBe(OPERATOR)
    for (let i = 1; i < stateChangedTicks.length; i++) {
      expect(stateChangedTicks[i].getTime()).toBeGreaterThan(
        stateChangedTicks[i - 1].getTime(),
      )
    }

    // Final authority: the target cell, and the machine agrees with the row.
    const final = await propertyRegion(PROP_LIFECYCLE)
    expect(final.source).toBe('organization_override')
    expect(authoritativeCellFor('completed', 'us', 'europe')).toBe(final.region)
  }, 30_000)

  it('(a2) the pause step really pauses the cell queues', async () => {
    const { request, advance } = stubbed()
    const requested = await request(
      { propertyId: PROP_PAUSE, toRegion: 'europe', reason: 'rehearsal move' },
      ctx,
    )
    if (!requested.ok) throw new Error('expected ok')

    await advance(
      { moveId: requested.move.id, toState: 'writes_paused', confirmedBy: OPERATOR },
      ctx,
    )

    expect(await defaultQueue.isPaused()).toBe(true)
    expect(await backgroundQueue.isPaused()).toBe(true)
  })

  it('(b) crash/retry: re-requesting a reached step is an idempotent no-op', async () => {
    const { request, advance } = stubbed()
    const requested = await request(
      { propertyId: PROP_RETRY, toRegion: 'europe', reason: 'rehearsal move' },
      ctx,
    )
    if (!requested.ok) throw new Error('expected ok')
    const moveId = requested.move.id

    await advance({ moveId, toState: 'writes_paused', confirmedBy: OPERATOR }, ctx)
    const retryPause = await advance(
      { moveId, toState: 'writes_paused', confirmedBy: OPERATOR },
      ctx,
    )
    expect(retryPause).toMatchObject({ advanced: false, note: 'already_in_state' })

    await advance({ moveId, toState: 'queues_drained', confirmedBy: OPERATOR }, ctx)
    const retryDrain = await advance(
      { moveId, toState: 'queues_drained', confirmedBy: OPERATOR },
      ctx,
    )
    expect(retryDrain).toMatchObject({ advanced: false, note: 'already_in_state' })

    const rows = await moveRowsFor(PROP_RETRY)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('queues_drained')
    const { region } = await propertyRegion(PROP_RETRY)
    expect(region).toBe('us')
  })

  it('(c) rollback: failed at queues_drained → rolled_back; source authoritative; queues resumed', async () => {
    const { request, advance } = stubbed()
    const requested = await request(
      { propertyId: PROP_ROLLBACK, toRegion: 'europe', reason: 'rehearsal move' },
      ctx,
    )
    if (!requested.ok) throw new Error('expected ok')
    const moveId = requested.move.id

    await advance({ moveId, toState: 'writes_paused', confirmedBy: OPERATOR }, ctx)
    expect(await defaultQueue.isPaused()).toBe(true)
    await advance({ moveId, toState: 'queues_drained', confirmedBy: OPERATOR }, ctx)

    const authorities: string[] = []
    const failed = await advance(
      {
        moveId,
        toState: 'failed',
        confirmedBy: OPERATOR,
        error: 'drain stalled\nwait=0',
      },
      ctx,
    )
    authorities.push(authoritativeCellFor(failed.move.state, 'us', 'europe'))

    const rolling = await advance(
      { moveId, toState: 'rolling_back', confirmedBy: OPERATOR },
      ctx,
    )
    authorities.push(authoritativeCellFor(rolling.move.state, 'us', 'europe'))
    expect(await defaultQueue.isPaused()).toBe(false)
    expect(await backgroundQueue.isPaused()).toBe(false)

    const rolledBack = await advance(
      { moveId, toState: 'rolled_back', confirmedBy: OPERATOR },
      ctx,
    )
    authorities.push(authoritativeCellFor(rolledBack.move.state, 'us', 'europe'))

    // Authority stayed the source throughout; the property row never moved.
    expect(authorities).toEqual(['us', 'us', 'us'])
    const { region, version } = await propertyRegion(PROP_ROLLBACK)
    expect(region).toBe('us')
    expect(version).toBe(1)

    const rows = await moveRowsFor(PROP_ROLLBACK)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('rolled_back')
    expect(rows[0].error).toBe('drain stalled')
  })

  it('(d) a country edit during an active move is region_locked and writes no row', async () => {
    const { request, update } = stubbed()
    const requested = await request(
      { propertyId: PROP_LOCKED, toRegion: 'europe', reason: 'rehearsal move' },
      ctx,
    )
    if (!requested.ok) throw new Error('expected ok')

    // Same-region edit (would be allowed without the move) is locked too.
    await expect(
      update({ propertyId: PROP_LOCKED, countryCode: 'PR' }, ctx),
    ).rejects.toSatisfy((e) => isPropertyError(e) && e.code === 'region_locked')
    await expect(
      update({ propertyId: PROP_LOCKED, countryCode: 'DE' }, ctx),
    ).rejects.toSatisfy((e) => isPropertyError(e) && e.code === 'region_locked')

    // Nothing silent: exactly the one move row, country untouched.
    expect(await moveRowsFor(PROP_LOCKED)).toHaveLength(1)
    const rows = await db.execute(
      sql`SELECT country_code, processing_region FROM properties WHERE id = ${PROP_LOCKED}`,
    )
    expect(rows.rows[0]).toMatchObject({ country_code: 'US', processing_region: 'us' })
  })

  it('(d2) without an active move a cross-region country edit throws region_locked and writes NO region_moves row', async () => {
    const { update } = stubbed()

    await expect(
      update({ propertyId: PROP_NO_MOVE, countryCode: 'DE' }, ctx),
    ).rejects.toSatisfy((e) => isPropertyError(e) && e.code === 'region_locked')

    expect(await moveRowsFor(PROP_NO_MOVE)).toHaveLength(0)
  })

  it('(e) a real request with no approved target denies typed + audited, no row', async () => {
    const { request } = makeUseCases(new Set(['us'])) // the REAL beta cell set

    const result = await request(
      { propertyId: PROP_DENIED, toRegion: 'europe', reason: 'planned EU expansion' },
      ctx,
    )

    expect(result).toEqual({ ok: false, reason: 'target_cell_not_approved' })
    expect(await moveRowsFor(PROP_DENIED)).toHaveLength(0)

    const auditRows = await db.execute(
      sql`SELECT actor_type, execution_kind, decision, action, reason
          FROM policy_decision_audit
          WHERE organization_id = ${ORG} AND property_id = ${PROP_DENIED}`,
    )
    expect(auditRows.rows).toHaveLength(1)
    expect(auditRows.rows[0]).toMatchObject({
      actor_type: 'operator',
      execution_kind: 'operator',
      decision: 'deny',
      action: 'policy.region.move.request',
    })
    expect(String((auditRows.rows[0] as { reason: string }).reason)).toContain(
      'target_cell_not_approved',
    )
  })
})
