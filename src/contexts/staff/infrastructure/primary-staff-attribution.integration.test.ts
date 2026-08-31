import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  createPrimaryStaffAttributionResolver,
  PrimaryStaffAttributionCorruptionError,
} from './primary-staff-attribution'

const ORG_A = organizationId('org-primary-staff-attribution-a')
const ORG_B = organizationId('org-primary-staff-attribution-b')
const PROPERTY_A = propertyId('b1000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('b1000000-0000-4000-8000-000000000002')
const PORTAL_A = portalId('b1000000-0000-4000-8000-000000000003')
const PORTAL_B = portalId('b1000000-0000-4000-8000-000000000004')
const PARTICIPANT_A = 'b1000000-0000-4000-8000-000000000011'
const PARTICIPANT_A_2 = 'b1000000-0000-4000-8000-000000000012'
const PARTICIPANT_B = 'b1000000-0000-4000-8000-000000000013'
const PARTICIPATION_A = 'b1000000-0000-4000-8000-000000000021'
const PARTICIPATION_A_2 = 'b1000000-0000-4000-8000-000000000022'
const PARTICIPATION_B = 'b1000000-0000-4000-8000-000000000023'
const PRIMARY_A = 'b1000000-0000-4000-8000-000000000031'
const PRIMARY_A_2 = 'b1000000-0000-4000-8000-000000000032'
const SUPPORTING_A = 'b1000000-0000-4000-8000-000000000033'
const SUPPORTING_A_2 = 'b1000000-0000-4000-8000-000000000034'
const START = new Date('2026-08-26T08:00:00.000Z')
const OBSERVED_AT = new Date('2026-08-27T08:00:00.000Z')
const END = new Date('2026-08-28T08:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_responsibilities',
    'staff_participations',
    'staff_participants',
    'portals',
    'properties',
  ],
  maxConnections: 6,
})

const resolvePrimary = createPrimaryStaffAttributionResolver(getDb())

async function insertResponsibility(
  input: Readonly<{
    id: string
    organizationId: string
    propertyId: string
    portalId: string
    participationId: string
    kind: 'primary' | 'supporting'
    effectiveFrom?: Date
    effectiveTo?: Date | null
  }>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_responsibilities
       (id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, effective_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test')`,
    [
      input.id,
      input.organizationId,
      input.propertyId,
      input.portalId,
      input.participationId,
      input.kind,
      input.effectiveFrom ?? START,
      input.effectiveTo ?? null,
    ],
  )
}

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Attribution Property A', 'primary-staff-attribution-a', 'UTC', $5, $5),
            ($2, $4, 'Attribution Property B', 'primary-staff-attribution-b', 'UTC', $5, $5)`,
    [PROPERTY_A, PROPERTY_B, ORG_A, ORG_B, START],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        created_by, created_at, updated_at)
     VALUES ($1, $3, $4::uuid, 'property', ($4::uuid)::text, 'Attribution Portal A',
             'primary-staff-attribution-a', 'test', $7, $7),
            ($2, $5, $6::uuid, 'property', ($6::uuid)::text, 'Attribution Portal B',
             'primary-staff-attribution-b', 'test', $7, $7)`,
    [PORTAL_A, PORTAL_B, ORG_A, PROPERTY_A, ORG_B, PROPERTY_B, START],
  )
  await getPool().query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, revision, created_by,
        created_at, updated_at)
     VALUES ($1, $4, 'Primary A', 'active', 1, 'test', $6, $6),
            ($2, $4, 'Primary A 2', 'active', 1, 'test', $6, $6),
            ($3, $5, 'Primary B', 'active', 1, 'test', $6, $6)`,
    [PARTICIPANT_A, PARTICIPANT_A_2, PARTICIPANT_B, ORG_A, ORG_B, START],
  )
  await getPool().query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, started_at, revision, created_by, created_at, updated_at)
     VALUES ($1, $4, $6, $7, 'Primary A', 'active', $10, 1, 'test', $10, $10),
            ($2, $4, $6, $8, 'Primary A 2', 'active', $10, 1, 'test', $10, $10),
            ($3, $5, $9, $11, 'Primary B', 'active', $10, 1, 'test', $10, $10)`,
    [
      PARTICIPATION_A,
      PARTICIPATION_A_2,
      PARTICIPATION_B,
      ORG_A,
      ORG_B,
      PROPERTY_A,
      PARTICIPANT_A,
      PARTICIPANT_A_2,
      PROPERTY_B,
      START,
      PARTICIPANT_B,
    ],
  )
})

describe.sequential('Primary Staff attribution PostgreSQL authority', () => {
  it('resolves one tenant-scoped Primary and ignores every supporting relationship', async () => {
    await Promise.all([
      insertResponsibility({
        id: SUPPORTING_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        participationId: PARTICIPATION_A,
        kind: 'supporting',
      }),
      insertResponsibility({
        id: SUPPORTING_A_2,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        participationId: PARTICIPATION_A_2,
        kind: 'supporting',
      }),
    ])

    await expect(
      resolvePrimary({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toBeNull()

    await insertResponsibility({
      id: PRIMARY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      participationId: PARTICIPATION_A,
      kind: 'primary',
    })

    await expect(
      resolvePrimary({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toEqual({
      staffParticipantId: PARTICIPANT_A,
      staffParticipationId: PARTICIPATION_A,
      portalResponsibilityId: PRIMARY_A,
      effectiveFrom: START,
      effectiveTo: null,
    })
  })

  it('does not leak a responsibility across tenant, Property, or Portal scope', async () => {
    await insertResponsibility({
      id: PRIMARY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      participationId: PARTICIPATION_A,
      kind: 'primary',
    })

    await expect(
      resolvePrimary({
        organizationId: ORG_B,
        propertyId: PROPERTY_B,
        portalId: PORTAL_A,
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toBeNull()
    await expect(
      resolvePrimary({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_B,
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toBeNull()

    await expect(
      insertResponsibility({
        id: PRIMARY_A_2,
        organizationId: ORG_B,
        propertyId: PROPERTY_B,
        portalId: PORTAL_A,
        participationId: PARTICIPATION_B,
        kind: 'primary',
      }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('fails closed when the retained Primary points to an inactive participation', async () => {
    await insertResponsibility({
      id: PRIMARY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      participationId: PARTICIPATION_A,
      kind: 'primary',
    })
    await getPool().query(
      `UPDATE staff_participations
       SET status = 'archived', ended_at = $2, archive_reason = 'left_property'
       WHERE id = $1`,
      [PARTICIPATION_A, OBSERVED_AT],
    )

    await expect(
      resolvePrimary({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        observedAt: OBSERVED_AT,
      }),
    ).rejects.toBeInstanceOf(PrimaryStaffAttributionCorruptionError)
  })

  it('serializes concurrent overlapping Primary writes so exactly one can commit', async () => {
    const writes = await Promise.allSettled([
      insertResponsibility({
        id: PRIMARY_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        participationId: PARTICIPATION_A,
        kind: 'primary',
        effectiveTo: END,
      }),
      insertResponsibility({
        id: PRIMARY_A_2,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        participationId: PARTICIPATION_A_2,
        kind: 'primary',
        effectiveTo: END,
      }),
    ])

    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = writes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(rejection?.reason).toMatchObject({ code: '23P01' })

    const retained = await getPool().query(
      `SELECT id FROM portal_responsibilities
       WHERE organization_id = $1 AND portal_id = $2 AND kind = 'primary'`,
      [ORG_A, PORTAL_A],
    )
    expect(retained.rows).toHaveLength(1)
  })
})
