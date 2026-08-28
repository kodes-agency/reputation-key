import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { RegionMoveRecord } from '../../domain/region-move-workflow'
import { createRegionMoveRequestCommandStore } from './region-move-request-command-store.adapter'

const db = getDb()
const ORGANIZATION_ID = 'org-region-move-request-atomicity'
const OTHER_ORGANIZATION_ID = 'org-region-move-request-other'
const PROPERTY_ID = 'f4000000-0000-4000-8000-000000000001'
const ACTOR_ID = 'operator-region-move-request'
const MOVE_ID = 'f4000000-0000-4000-8000-000000000002'
const SECOND_MOVE_ID = 'f4000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-08-27T04:00:00.000Z')

const move: RegionMoveRecord = {
  id: MOVE_ID,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  fromRegion: 'us',
  toRegion: 'europe',
  state: 'requested',
  stateRevision: 1,
  denialReason: null,
  requestedBy: ACTOR_ID,
  requestedAt: NOW,
  stateChangedAt: NOW,
  completedAt: null,
  error: null,
}

const audit = {
  actorUserId: ACTOR_ID,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  action: 'policy.region.move.request',
  decision: 'allow',
  reason: 'region move requested: us → europe (residency correction)',
} as const

async function clearRows() {
  await db.execute(sql`
    DELETE FROM policy_decision_audit
    WHERE organization_id IN (${ORGANIZATION_ID}, ${OTHER_ORGANIZATION_ID})
      AND action = 'policy.region.move.request'
  `)
  await db.execute(sql`DELETE FROM region_moves WHERE property_id = ${PROPERTY_ID}`)
}

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION_ID}, 'Region Move Atomicity', ${ORGANIZATION_ID}, ${NOW})
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (
      ${OTHER_ORGANIZATION_ID}, 'Region Move Other', ${OTHER_ORGANIZATION_ID}, ${NOW}
    )
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, processing_region, data_cell_id,
      processing_region_source, processing_region_resolved_at, created_at, updated_at
    ) VALUES (
      ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'Region Move Property',
      'region-move-atomicity', 'UTC', 'us', 'us', 'country_policy', ${NOW}, ${NOW}, ${NOW}
    )
    ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(clearRows)

afterAll(async () => {
  await clearRows()
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await deleteTestOrganizations(db, [OTHER_ORGANIZATION_ID, ORGANIZATION_ID])
})

describe('region-move request command store', () => {
  it('co-commits the requested move and its required operator decision', async () => {
    await createRegionMoveRequestCommandStore(db).recordRequest({ move, audit })

    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM region_moves WHERE id = ${MOVE_ID}) AS move_count,
        (SELECT count(*)::int FROM policy_decision_audit
          WHERE organization_id = ${ORGANIZATION_ID}
            AND property_id = ${PROPERTY_ID}
            AND action = 'policy.region.move.request'
            AND decision = 'allow') AS audit_count
    `)

    expect(rows.rows[0]).toEqual({ move_count: 1, audit_count: 1 })
  })

  it('rolls the move back when the required audit append fails', async () => {
    const store = createRegionMoveRequestCommandStore(db, {
      writeAudit: async () => {
        throw new Error('injected region-move audit failure')
      },
    })

    await expect(store.recordRequest({ move, audit })).rejects.toThrow(
      'injected region-move audit failure',
    )

    const rows = await db.execute(sql`
      SELECT count(*)::int AS move_count FROM region_moves WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({ move_count: 0 })
  })

  it('rejects mismatched audit scope before writing either authority', async () => {
    const store = createRegionMoveRequestCommandStore(db)

    await expect(
      store.recordRequest({
        move,
        audit: { ...audit, propertyId: 'f4000000-0000-4000-8000-000000000099' },
      }),
    ).rejects.toThrow('Region move request audit does not match the requested move')

    const rows = await db.execute(sql`
      SELECT count(*)::int AS move_count FROM region_moves WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({ move_count: 0 })
  })

  it('rejects a Property that does not belong to the command tenant', async () => {
    const store = createRegionMoveRequestCommandStore(db)
    const crossTenantMove = {
      ...move,
      organizationId: OTHER_ORGANIZATION_ID,
    }
    const crossTenantAudit = {
      ...audit,
      organizationId: OTHER_ORGANIZATION_ID,
    }

    await expect(
      store.recordRequest({
        move: crossTenantMove,
        audit: crossTenantAudit,
      }),
    ).rejects.toThrow('does not belong to the command tenant')

    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM region_moves WHERE id = ${MOVE_ID}) AS move_count,
        (SELECT count(*)::int FROM policy_decision_audit
          WHERE organization_id = ${OTHER_ORGANIZATION_ID}
            AND action = 'policy.region.move.request') AS audit_count
    `)
    expect(rows.rows[0]).toEqual({ move_count: 0, audit_count: 0 })
  })

  it('rejects a request that does not begin at the initial state revision', async () => {
    const store = createRegionMoveRequestCommandStore(db)

    await expect(
      store.recordRequest({
        move: { ...move, state: 'completed', stateRevision: 2 },
        audit,
      }),
    ).rejects.toThrow('Region move request must start at requested revision 1')

    const rows = await db.execute(sql`
      SELECT count(*)::int AS move_count FROM region_moves WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({ move_count: 0 })
  })

  it('allows only one concurrent active move authority for a Property', async () => {
    const first = createRegionMoveRequestCommandStore(db)
    const second = createRegionMoveRequestCommandStore(db)

    const outcomes = await Promise.all([
      first.recordRequest({ move, audit }),
      second.recordRequest({
        move: { ...move, id: SECOND_MOVE_ID },
        audit,
      }),
    ])

    expect(outcomes.sort()).toEqual(['active_move_exists', 'recorded'])

    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::int
           FROM region_moves
          WHERE property_id = ${PROPERTY_ID}
            AND state NOT IN ('completed', 'rolled_back')) AS active_move_count,
        (SELECT count(*)::int
           FROM policy_decision_audit
          WHERE organization_id = ${ORGANIZATION_ID}
            AND property_id = ${PROPERTY_ID}
            AND action = 'policy.region.move.request'
            AND decision = 'allow') AS allow_audit_count
    `)
    expect(rows.rows[0]).toEqual({ active_move_count: 1, allow_audit_count: 1 })
  })

  it('retains terminal history while allowing one later active move', async () => {
    const store = createRegionMoveRequestCommandStore(db)
    await expect(store.recordRequest({ move, audit })).resolves.toBe('recorded')
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'completed', state_revision = 8
       WHERE id = ${MOVE_ID}
    `)

    await expect(
      store.recordRequest({
        move: { ...move, id: SECOND_MOVE_ID },
        audit,
      }),
    ).resolves.toBe('recorded')

    const rows = await db.execute(sql`
      SELECT count(*)::int AS total_count,
             count(*) FILTER (
               WHERE state NOT IN ('completed', 'rolled_back')
             )::int AS active_count
        FROM region_moves
       WHERE property_id = ${PROPERTY_ID}
    `)
    expect(rows.rows[0]).toEqual({ total_count: 2, active_count: 1 })
  })
})
