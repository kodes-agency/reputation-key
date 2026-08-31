import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

const db = getDb()
const ORG = 'org-data-cell-immutability'
const ASSIGNED = 'dc000000-0000-4000-8000-000000000001'
const UNASSIGNED = 'dc000000-0000-4000-8000-000000000002'
const MOVE = 'dc000000-0000-4000-8000-000000000003'
const LEGACY_INSERT = 'dc000000-0000-4000-8000-000000000004'

async function clearFixtures(): Promise<void> {
  await db.execute(sql`DELETE FROM region_moves WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
}

async function seedProperties(): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, country_code,
      processing_region, data_cell_id, routing_policy_version
    ) VALUES
      (${ASSIGNED}, ${ORG}, 'Assigned', 'data-cell-assigned', 'UTC', 'US', 'us', 'us', 2),
      (${UNASSIGNED}, ${ORG}, 'Unassigned', 'data-cell-unassigned', 'UTC', NULL, 'unresolved', NULL, 2)
  `)
}

async function assignment(propertyId: string): Promise<{
  data_cell_id: string | null
  processing_region: string | null
}> {
  const result = await db.execute(sql`
    SELECT data_cell_id, processing_region
    FROM properties
    WHERE id = ${propertyId}
  `)
  return result.rows[0] as {
    data_cell_id: string | null
    processing_region: string | null
  }
}

function hasPostgresCode(error: unknown, code: string): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: unknown }
  return candidate.code === code || hasPostgresCode(candidate.cause, code)
}

beforeAll(async () => {
  await clearFixtures()
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Data Cell Guard', ${ORG}, now())
  `)
})

beforeEach(async () => {
  await clearFixtures()
  await seedProperties()
})

afterAll(async () => {
  await clearFixtures()
  await deleteTestOrganizations(db, [ORG])
})

describe.sequential('Property Data Cell assignment guard', () => {
  it('dual-writes the canonical assignment for a rolling legacy insert', async () => {
    await db.execute(sql`
      INSERT INTO properties (
        id, organization_id, name, slug, timezone, country_code,
        processing_region, routing_policy_version
      ) VALUES (
        ${LEGACY_INSERT}, ${ORG}, 'Legacy insert', 'data-cell-legacy-insert',
        'UTC', 'US', 'us', 2
      )
    `)

    await expect(assignment(LEGACY_INSERT)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })

  it('dual-writes when a rolling legacy update resolves an unassigned row', async () => {
    await db.execute(sql`
      UPDATE properties
      SET processing_region = 'us'
      WHERE id = ${UNASSIGNED}
    `)

    await expect(assignment(UNASSIGNED)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })

  it('allows one initial assignment for an unresolved expand-phase row', async () => {
    await db.execute(sql`
      UPDATE properties
      SET processing_region = 'us', data_cell_id = 'us'
      WHERE id = ${UNASSIGNED}
    `)

    await expect(assignment(UNASSIGNED)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })

  it('rejects clearing or directly changing an assigned Data Cell', async () => {
    await expect(
      db.execute(sql`
        UPDATE properties
        SET processing_region = 'europe', data_cell_id = 'europe'
        WHERE id = ${ASSIGNED}
      `),
    ).rejects.toSatisfy((error: unknown) => hasPostgresCode(error, '23514'))

    await expect(
      db.execute(sql`UPDATE properties SET data_cell_id = NULL WHERE id = ${ASSIGNED}`),
    ).rejects.toSatisfy((error: unknown) => hasPostgresCode(error, '23514'))

    await expect(assignment(ASSIGNED)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })

  it('rejects drift in the legacy compatibility column', async () => {
    await expect(
      db.execute(sql`
        UPDATE properties SET processing_region = 'europe' WHERE id = ${ASSIGNED}
      `),
    ).rejects.toSatisfy((error: unknown) => hasPostgresCode(error, '23514'))
  })

  it('allows country corrections without changing the assigned cell', async () => {
    await db.execute(sql`
      UPDATE properties SET country_code = 'PR' WHERE id = ${ASSIGNED}
    `)

    await expect(assignment(ASSIGNED)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })

  it('allows only the matching operator move activation and rollback states', async () => {
    await db.execute(sql`
      INSERT INTO region_moves (
        id, property_id, organization_id, from_region, to_region, state,
        requested_by, requested_at, state_changed_at
      ) VALUES (
        ${MOVE}, ${ASSIGNED}, ${ORG}, 'us', 'europe', 'verified',
        'operator-1', now(), now()
      )
    `)

    await db.execute(sql`
      UPDATE properties
      SET processing_region = 'europe', data_cell_id = 'europe'
      WHERE id = ${ASSIGNED}
    `)
    await expect(assignment(ASSIGNED)).resolves.toEqual({
      data_cell_id: 'europe',
      processing_region: 'europe',
    })

    await db.execute(sql`UPDATE region_moves SET state = 'failed' WHERE id = ${MOVE}`)
    await db.execute(sql`
      UPDATE properties
      SET processing_region = 'us', data_cell_id = 'us'
      WHERE id = ${ASSIGNED}
    `)
    await expect(assignment(ASSIGNED)).resolves.toEqual({
      data_cell_id: 'us',
      processing_region: 'us',
    })
  })
})
