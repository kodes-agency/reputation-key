import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { isPropertyError } from '../../domain/errors'
import { createRegionMoveRepository } from './region-move.repository'

const db = getDb()
const ORGANIZATION_ID = 'org-region-move-cas'
const PROPERTY_ID = 'f4100000-0000-4000-8000-000000000001'
const MOVE_ID = 'f4100000-0000-4000-8000-000000000002'
const NOW = new Date('2026-08-28T08:00:00.000Z')

const resetMove = async () => {
  await db.execute(sql`DELETE FROM region_moves WHERE id = ${MOVE_ID}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, processing_region, data_cell_id,
      processing_region_source, processing_region_resolved_at, created_at, updated_at
    ) VALUES (
      ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'Region Move CAS Property',
      'region-move-cas', 'UTC', 'us', 'us', 'country_policy', ${NOW}, ${NOW}, ${NOW}
    )
  `)
  await db.execute(sql`
    INSERT INTO region_moves (
      id, property_id, organization_id, from_region, to_region, state,
      requested_by, requested_at, state_changed_at
    ) VALUES (
      ${MOVE_ID}, ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'us', 'europe',
      'requested', 'operator-region-move-cas', ${NOW}, ${NOW}
    )
  `)
}

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION_ID}, 'Region Move CAS', ${ORGANIZATION_ID}, ${NOW})
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, processing_region, data_cell_id,
      processing_region_source, processing_region_resolved_at, created_at, updated_at
    ) VALUES (
      ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'Region Move CAS Property',
      'region-move-cas', 'UTC', 'us', 'us', 'country_policy', ${NOW}, ${NOW}, ${NOW}
    )
    ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(resetMove)

afterAll(async () => {
  await db.execute(sql`DELETE FROM region_moves WHERE id = ${MOVE_ID}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
})

describe('region move transition compare-and-swap', () => {
  it('keeps reads and transition writes tenant-scoped', async () => {
    const store = createRegionMoveRepository(db)

    await expect(
      store.findMoveById('org-region-move-other' as never, MOVE_ID),
    ).resolves.toBeNull()
    await expect(
      store.updateMoveState('org-region-move-other' as never, MOVE_ID, {
        expectedState: 'requested',
        expectedStateRevision: 1,
        state: 'failed',
        requestedBy: 'cross-tenant-operator',
        stateChangedAt: new Date('2026-08-28T08:00:30.000Z'),
        error: 'cross tenant attempt',
      }),
    ).resolves.toBe('stale')

    const rows = await db.execute(sql`
      SELECT state, state_revision, requested_by
        FROM region_moves
       WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({
      state: 'requested',
      state_revision: 1,
      requested_by: 'operator-region-move-cas',
    })
  })

  it('allows only one transition from the same expected state revision', async () => {
    const store = createRegionMoveRepository(db)

    const outcomes = await Promise.all([
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'requested',
        expectedStateRevision: 1,
        state: 'writes_paused',
        requestedBy: 'operator-a',
        stateChangedAt: new Date('2026-08-28T08:01:00.000Z'),
      }),
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'requested',
        expectedStateRevision: 1,
        state: 'failed',
        requestedBy: 'operator-b',
        stateChangedAt: new Date('2026-08-28T08:01:00.000Z'),
        error: 'operator stopped the move',
      }),
    ])

    expect(outcomes.sort()).toEqual(['stale', 'updated'])
    const rows = await db.execute(sql`
      SELECT state, state_revision FROM region_moves WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toMatchObject({ state_revision: 2 })
    expect(['writes_paused', 'failed']).toContain(rows.rows[0]?.state)
  })

  it('does not move a terminal row when a stale stepper presents an old revision', async () => {
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'completed', state_revision = 8
       WHERE id = ${MOVE_ID}
    `)
    const store = createRegionMoveRepository(db)

    await expect(
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'verified',
        expectedStateRevision: 7,
        state: 'target_activated',
        requestedBy: 'stale-operator',
        stateChangedAt: new Date('2026-08-28T08:02:00.000Z'),
      }),
    ).resolves.toBe('stale')

    const rows = await db.execute(sql`
      SELECT rm.state, rm.state_revision, rm.requested_by,
             p.processing_region, p.data_cell_id
        FROM region_moves rm
        JOIN properties p ON p.id = rm.property_id
       WHERE rm.id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({
      state: 'completed',
      state_revision: 8,
      requested_by: 'operator-region-move-cas',
      processing_region: 'us',
      data_cell_id: 'us',
    })
  })

  it('co-commits target activation with the winning state-revision CAS', async () => {
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'verified', state_revision = 5
       WHERE id = ${MOVE_ID}
    `)
    const store = createRegionMoveRepository(db)

    await expect(
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'verified',
        expectedStateRevision: 5,
        state: 'target_activated',
        requestedBy: 'activation-winner',
        stateChangedAt: new Date('2026-08-28T08:02:30.000Z'),
      }),
    ).resolves.toBe('updated')

    const rows = await db.execute(sql`
      SELECT rm.state, rm.state_revision, p.processing_region, p.data_cell_id
        FROM region_moves rm
        JOIN properties p ON p.id = rm.property_id
       WHERE rm.id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({
      state: 'target_activated',
      state_revision: 6,
      processing_region: 'europe',
      data_cell_id: 'europe',
    })
  })

  it('rolls back the state CAS when source-authority restoration fails', async () => {
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'verified', state_revision = 5,
             from_region = 'us', to_region = 'global'
       WHERE id = ${MOVE_ID}
    `)
    await db.execute(sql`
      UPDATE properties
         SET processing_region = 'global', data_cell_id = 'global'
       WHERE id = ${PROPERTY_ID}
    `)
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'failed', state_revision = 6,
             from_region = 'us', to_region = 'europe'
       WHERE id = ${MOVE_ID}
    `)
    const store = createRegionMoveRepository(db)

    await expect(
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'failed',
        expectedStateRevision: 6,
        state: 'rolling_back',
        requestedBy: 'rollback-operator',
        stateChangedAt: new Date('2026-08-28T08:02:45.000Z'),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isPropertyError(error) && error.code === 'region_move_conflict',
    )

    const rows = await db.execute(sql`
      SELECT rm.state, rm.state_revision, rm.requested_by,
             p.processing_region, p.data_cell_id
        FROM region_moves rm
        JOIN properties p ON p.id = rm.property_id
       WHERE rm.id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({
      state: 'failed',
      state_revision: 6,
      requested_by: 'operator-region-move-cas',
      processing_region: 'global',
      data_cell_id: 'global',
    })
  })

  it('refuses to move a terminal row even with its current revision', async () => {
    await db.execute(sql`
      UPDATE region_moves
         SET state = 'completed', state_revision = 8
       WHERE id = ${MOVE_ID}
    `)
    const store = createRegionMoveRepository(db)

    await expect(
      store.updateMoveState(ORGANIZATION_ID as never, MOVE_ID, {
        expectedState: 'completed',
        expectedStateRevision: 8,
        state: 'requested',
        requestedBy: 'terminal-row-operator',
        stateChangedAt: new Date('2026-08-28T08:03:00.000Z'),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isPropertyError(error) && error.code === 'invalid_transition',
    )

    const rows = await db.execute(sql`
      SELECT state, state_revision, requested_by
        FROM region_moves
       WHERE id = ${MOVE_ID}
    `)
    expect(rows.rows[0]).toEqual({
      state: 'completed',
      state_revision: 8,
      requested_by: 'operator-region-move-cas',
    })
  })
})
