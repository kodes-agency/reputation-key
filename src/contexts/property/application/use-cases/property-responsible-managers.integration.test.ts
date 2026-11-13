// Property context — Responsible Manager use cases against real PostgreSQL: the
// Property repository, the manager assignment repository and the outbox decide
// the outcome.

import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { createPropertyRepository } from '../../infrastructure/repositories/property.repository'
import { seedTestProperty } from '../../infrastructure/property-test-fixtures'
import { createPropertyResponsibleManagerRepository } from '../../responsibility/manager-repository.server'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './property-responsible-managers'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORG_A = organizationId('org-responsible-managers-a')
const ORG_B = organizationId('org-responsible-managers-b')
const PROPERTY = buildTestProperty({
  id: 'c9200000-0000-4000-8000-000000000001',
  slug: 'responsible-managers',
  organizationId: ORG_A,
  responsibleManagerRevision: 1,
  responsibilityNeededSince: NOW,
})

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['outbox_events', 'property_responsible_managers', 'properties'],
})
const db = getDb()

const activeUserIds = async () =>
  (
    await getPool().query(
      `SELECT user_id FROM property_responsible_managers
       WHERE organization_id = $1 AND effective_to IS NULL ORDER BY user_id`,
      [ORG_A],
    )
  ).rows.map((row) => row.user_id as string)

const releases = async () =>
  (
    await getPool().query(
      `SELECT user_id, effective_to, end_reason, created_by FROM property_responsible_managers
       WHERE organization_id = $1 AND end_reason IS NOT NULL`,
      [ORG_A],
    )
  ).rows

const recoveryFacts = async () =>
  (
    await getPool().query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'property.responsibility_became_needed'`,
      [ORG_A],
    )
  ).rows.map((row) => row.payload as Record<string, unknown>)

/**
 * `removedWhileSaving`: members whose removal commits after the save has read
 * them as eligible and before its own write commits.
 */
const setup = async (removedWhileSaving: readonly string[] = []) => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedTestProperty(db, PROPERTY)
  const realManagerRepo = createPropertyResponsibleManagerRepository(db)
  const gone = new Set<string>()
  const managerRepo: typeof realManagerRepo = {
    ...realManagerRepo,
    replace: async (input) => {
      const result = await realManagerRepo.replace(input)
      removedWhileSaving.forEach((userId) => gone.add(userId))
      return result
    },
  }
  return {
    propertyRepo: createPropertyRepository(db),
    managerRepo,
    identityPublicApi: {
      listActiveManagers: async () =>
        [
          {
            userId: 'admin-1',
            role: 'AccountAdmin' as const,
            propertyAccessScope: 'organization' as const,
          },
          {
            userId: 'manager-1',
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
          {
            userId: 'manager-no-grant',
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
        ].filter((member) => !gone.has(member.userId)),
    },
    staffPublicApi: {
      getAccessiblePropertyIds: async (_org: string, userId: string) =>
        userId === 'manager-no-grant' ? [] : [PROPERTY.id],
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  }
}

const accountAdmin = () =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: ORG_A })

describe('Property Responsible Managers', () => {
  it('lists explicit assignments separately from eligible candidates', async () => {
    const deps = await setup()
    const result = await listPropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id },
      accountAdmin(),
    )

    expect(result.assignments).toEqual([])
    expect(result.eligibleManagers).toEqual([
      {
        userId: 'admin-1',
        role: 'AccountAdmin',
        propertyAccessScope: 'organization',
      },
      {
        userId: 'manager-1',
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
    ])
    expect(result).toMatchObject({
      revision: 1,
      responsibilityNeeded: true,
      responsibilityNeededSince: NOW,
    })
  })

  it('supports multiple managers and rejects a manager without a current grant', async () => {
    const deps = await setup()
    const ctx = accountAdmin()

    const result = await updatePropertyResponsibleManagers(deps)(
      {
        propertyId: PROPERTY.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      ctx,
    )
    expect(result.assignments.map((row) => row.userId).sort()).toEqual([
      'admin-1',
      'manager-1',
    ])
    expect(await activeUserIds()).toEqual(['admin-1', 'manager-1'])

    await expect(
      updatePropertyResponsibleManagers(deps)(
        {
          propertyId: PROPERTY.id,
          managerUserIds: ['manager-no-grant'],
          expectedRevision: 2,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'responsible_manager_ineligible',
    })
    expect(await activeUserIds()).toEqual(['admin-1', 'manager-1'])
  })

  it('releases a manager removed while the save committed, keeps the others and refuses the save', async () => {
    const deps = await setup(['manager-1'])

    await expect(
      updatePropertyResponsibleManagers(deps)(
        {
          propertyId: PROPERTY.id,
          managerUserIds: ['admin-1', 'manager-1'],
          expectedRevision: 1,
        },
        accountAdmin(),
      ),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'responsible_manager_ineligible',
    })

    expect(await activeUserIds()).toEqual(['admin-1'])
    // The clock has not moved since the assignment: an interval ends after it began.
    // Nobody chose this gap, so nobody is left out of its notice.
    expect(await releases()).toEqual([
      {
        user_id: 'manager-1',
        effective_to: new Date(NOW.getTime() + 1),
        end_reason: 'manager_became_ineligible',
        created_by: expect.anything(),
      },
    ])
  })

  it('releases nobody when every assigned manager is still eligible after the commit', async () => {
    const deps = await setup()

    await updatePropertyResponsibleManagers(deps)(
      {
        propertyId: PROPERTY.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      accountAdmin(),
    )

    expect(await activeUserIds()).toEqual(['admin-1', 'manager-1'])
    expect(await releases()).toEqual([])
  })

  it('records recovery only when an owned Property loses its last manager', async () => {
    // Each save is a minute apart: an assignment cannot end where it began.
    let minute = 0
    const deps = {
      ...(await setup()),
      clock: () => new Date(NOW.getTime() + minute++ * 60_000),
    }
    const ctx = accountAdmin()

    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: ['admin-1'], expectedRevision: 1 },
      ctx,
    )
    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: [], expectedRevision: 2 },
      ctx,
    )
    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: [], expectedRevision: 3 },
      ctx,
    )

    // The admin who cleared the list is not asked to fix it (ADR 0046).
    expect(await recoveryFacts()).toEqual([
      expect.objectContaining({
        propertyId: PROPERTY.id,
        organizationId: PROPERTY.organizationId,
        actorUserId: ctx.userId,
      }),
    ])
  })
})
