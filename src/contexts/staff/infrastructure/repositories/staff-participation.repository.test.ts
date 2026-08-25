import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { createStaffParticipationRepository } from './staff-participation.repository'

const ORG_A = 'org-staff-participation-a'
const ORG_B = 'org-staff-participation-b'
const PROPERTY_A = 'db000000-0000-4000-8000-000000000001'
const PROPERTY_B = 'db000000-0000-4000-8000-000000000002'
const PARTICIPATION = 'db000000-0000-4000-8000-000000000011'
const PORTAL_A = 'db000000-0000-4000-8000-000000000021'
const PORTAL_B = 'db000000-0000-4000-8000-000000000022'
const PORTAL_C = 'db000000-0000-4000-8000-000000000023'
const START = new Date('2026-08-07T12:00:00.000Z')
const CHANGE = new Date('2026-08-08T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG_A, ORG_B]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Property A', 'staff-participation-a', 'UTC', NOW(), NOW()),
            ($2, $4, 'Property B', 'staff-participation-b', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_A, PROPERTY_B, ORG_A, ORG_B],
  )
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM portal_responsibilities WHERE organization_id IN ($1, $2)',
    [ORG_A, ORG_B],
  )
  await pool.query('DELETE FROM staff_participations WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.end()
})

beforeEach(async () => {
  await pool.query(
    'DELETE FROM portal_responsibilities WHERE organization_id IN ($1, $2)',
    [ORG_A, ORG_B],
  )
  await pool.query('DELETE FROM staff_participations WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $4, $5::uuid, 'property', $5::uuid::text, 'Portal A', 'staff-portal-a', NOW(), NOW()),
            ($2, $6, $7::uuid, 'property', $7::uuid::text, 'Portal B', 'staff-portal-b', NOW(), NOW()),
            ($3, $4, $5::uuid, 'property', $5::uuid::text, 'Portal C', 'staff-portal-c', NOW(), NOW())`,
    [PORTAL_A, PORTAL_B, PORTAL_C, ORG_A, PROPERTY_A, ORG_B, PROPERTY_B],
  )
})

const participation = () => ({
  id: PARTICIPATION,
  organizationId: ORG_A,
  propertyId: PROPERTY_A,
  userId: 'user-staff-participation',
  displayName: 'Alex',
  status: 'active' as const,
  startedAt: START,
  endedAt: null,
  createdBy: 'owner',
  updatedAt: START,
})

describe('staff participation repository', () => {
  it('creates one active participation idempotently and isolates tenant reads', async () => {
    const repo = createStaffParticipationRepository(getDb())
    const first = await repo.create(participation())
    const duplicate = await repo.create({
      ...participation(),
      id: 'db000000-0000-4000-8000-000000000012',
    })

    expect(duplicate.id).toBe(first.id)
    await expect(repo.findById(ORG_B, first.id)).resolves.toBeNull()
    await expect(repo.list(ORG_A, { activeOnly: true })).resolves.toHaveLength(1)
  })

  it('persists an idempotent responsibility set and rejects a cross-property portal', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await repo.create(participation())
    const input = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' as const }],
      actorId: 'owner',
      at: START,
    }
    const first = await repo.replaceResponsibilities(input)
    const repeated = await repo.replaceResponsibilities(input)

    expect(repeated).toEqual(first)
    await expect(
      repo.replaceResponsibilities({
        ...input,
        selections: [{ portalId: PORTAL_B, kind: 'primary' }],
        at: CHANGE,
      }),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'invalid_input' })
    await expect(repo.listActiveResponsibilities(ORG_A, PARTICIPATION)).resolves.toEqual(
      first,
    )
  })

  it('preserves unchanged responsibility intervals during a partial edit', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await repo.create(participation())
    const [original] = await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' }],
      actorId: 'owner',
      at: START,
    })

    const changed = await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [
        { portalId: PORTAL_A, kind: 'primary' },
        { portalId: PORTAL_C, kind: 'supporting' },
      ],
      actorId: 'manager',
      at: CHANGE,
    })

    expect(changed.find((row) => row.portalId === PORTAL_A)).toMatchObject({
      id: original.id,
      effectiveFrom: START,
      createdBy: 'owner',
    })
    expect(changed.find((row) => row.portalId === PORTAL_C)).toMatchObject({
      effectiveFrom: CHANGE,
      createdBy: 'manager',
    })

    const unchangedHistory = await pool.query(
      `SELECT effective_from, effective_to
       FROM portal_responsibilities
       WHERE staff_participation_id = $1 AND portal_id = $2`,
      [PARTICIPATION, PORTAL_A],
    )
    expect(unchangedHistory.rows).toHaveLength(1)
    expect(new Date(unchangedHistory.rows[0].effective_from)).toEqual(START)
    expect(unchangedHistory.rows[0].effective_to).toBeNull()
  })

  it('archives participation and closes responsibility history transactionally', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await repo.create(participation())
    await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' }],
      actorId: 'owner',
      at: START,
    })

    const archived = await repo.archive(ORG_A, PARTICIPATION, CHANGE, 'left_property')

    expect(archived).toMatchObject({ status: 'archived', endedAt: CHANGE })
    await expect(repo.listActiveResponsibilities(ORG_A, PARTICIPATION)).resolves.toEqual(
      [],
    )
    const history = await pool.query(
      `SELECT effective_to, end_reason FROM portal_responsibilities WHERE staff_participation_id = $1`,
      [PARTICIPATION],
    )
    expect(new Date(history.rows[0].effective_to)).toEqual(CHANGE)
    expect(history.rows[0].end_reason).toBe('participation_archived')
  })
})
