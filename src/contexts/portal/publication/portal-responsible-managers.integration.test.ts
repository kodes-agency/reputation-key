// A Portal's responsible managers on real PostgreSQL, with two organizations:
// listing assignments beside the eligible candidates, saving a new set, the
// release of a manager who lost eligibility while the save committed, the
// transition into "responsibility needed", and the facts the Portal Contact
// Request authority reads. The real use cases run over the real Portal and
// assignment stores; only the clock and the Identity-side membership and grant
// facts are supplied.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  IdentityManagerFactsPublicApi,
  StaffPublicApi,
} from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import { organizationId, portalId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { getPortalContactRequestManagerAuthorityFacts } from './contact-request-authority.server'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from '../application/use-cases/portal-responsible-managers'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalResponsibleManagerRepository } from '../infrastructure/repositories/portal-responsible-manager.repository'
import {
  seedClusterPortal,
  type SeededClusterPortal,
} from '../infrastructure/testing/portal-token-cluster-fixtures'
import type { PortalResponsibleManagerRepository } from '../application/ports/portal-responsible-manager.repository'

const ORG_A = organizationId('org-resp-managers-0000000000001')
const ORG_B = organizationId('org-resp-managers-0000000000002')
const NOW = new Date('2026-08-25T12:00:00.000Z')
const CREATOR = 'creator-1'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['portal_responsible_managers', 'outbox_events', 'portals', 'properties'],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

/** The Organization's active managers as Identity reports them. */
const MEMBERS: Readonly<Record<string, Awaited<ReturnType<ListManagers>>>> = {
  [ORG_A]: [
    { userId: 'admin-1', role: 'AccountAdmin', propertyAccessScope: 'organization' },
    {
      userId: 'manager-1',
      role: 'PropertyManager',
      propertyAccessScope: 'assigned-properties',
    },
    {
      userId: 'manager-no-grant',
      role: 'PropertyManager',
      propertyAccessScope: 'assigned-properties',
    },
  ],
  [ORG_B]: [
    { userId: 'admin-b', role: 'AccountAdmin', propertyAccessScope: 'organization' },
  ],
}

type ListManagers = IdentityManagerFactsPublicApi['listActiveManagers']

async function seedPortal(org: string, assigned: readonly string[] = ['admin-1']) {
  const portal = await seedClusterPortal(getPool(), org, {
    createdBy: CREATOR,
    updatedAt: NOW,
  })
  for (const user of assigned) {
    await getPool().query(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [org, portal.propertyId, portal.id, user, NOW, CREATOR],
    )
  }
  return portal
}

type Wiring = Readonly<{
  /** Members whose removal commits after the save has read them as eligible. */
  removedWhileSaving?: readonly string[]
  /** Who Identity reports as an active manager, when it differs from MEMBERS. */
  members?: Readonly<Record<string, Awaited<ReturnType<ListManagers>>>>
  granted: readonly SeededClusterPortal[]
}>

function wire(options: Wiring) {
  const db = getDb()
  const gone = new Set<string>()
  const members = options.members ?? MEMBERS
  const inner = createPortalResponsibleManagerRepository(db)
  const managerRepo: PortalResponsibleManagerRepository = {
    ...inner,
    replace: async (input) => {
      for (const user of options.removedWhileSaving ?? []) gone.add(user)
      return inner.replace(input)
    },
  }
  const identityPublicApi: IdentityManagerFactsPublicApi = {
    listActiveManagers: async (org) =>
      (members[org] ?? []).filter((member) => !gone.has(member.userId)),
  }
  const staffPublicApi = {
    getAccessiblePropertyIds: async (_org: string, user: string) =>
      user === 'manager-no-grant'
        ? []
        : options.granted.map((portal) => portal.propertyId),
    getAssignedPortals: async () => [],
  } as unknown as StaffPublicApi
  const portalRepo = createPortalRepository(db)
  const deps = {
    portalRepo,
    managerRepo,
    identityPublicApi,
    staffPublicApi,
    clock: () => NOW,
  }
  return {
    list: listPortalResponsibleManagers(deps),
    update: updatePortalResponsibleManagers(deps),
    authorityFacts: getPortalContactRequestManagerAuthorityFacts(deps),
  }
}

const adminOf = (org: string) =>
  buildTestAuthContext({ organizationId: organizationId(org), role: 'AccountAdmin' })

type AssignmentRow = Readonly<{
  user_id: string
  effective_from: Date
  effective_to: Date | null
  end_reason: string | null
}>

const assignmentsOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<AssignmentRow>(
      `SELECT user_id, effective_from, effective_to, end_reason
       FROM portal_responsible_managers WHERE portal_id = $1 ORDER BY user_id`,
      [portal.id],
    )
  ).rows

const activeOf = async (portal: Readonly<{ id: string }>) =>
  (await assignmentsOf(portal))
    .filter((row) => row.effective_to === null)
    .map((row) => row.user_id)

const revisionOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<{ responsible_manager_revision: number }>(
      'SELECT responsible_manager_revision FROM portals WHERE id = $1',
      [portal.id],
    )
  ).rows[0]?.responsible_manager_revision

const factsOf = async (org: string, tag: string) =>
  (
    await getPool().query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2`,
      [org, tag],
    )
  ).rows.map((row) => row.payload)

const INELIGIBLE = { _tag: 'PortalError', code: 'responsible_manager_ineligible' }

describe.sequential('Portal Responsible Managers (real PostgreSQL, two tenants)', () => {
  it('lists assignments separately from the eligible manager candidates, per organization', async () => {
    const portalA = await seedPortal(ORG_A)
    const portalB = await seedPortal(ORG_B, ['admin-b'])
    const { list } = wire({ granted: [portalA, portalB] })

    const result = await list({ portalId: portalA.id }, adminOf(ORG_A))

    expect(result.assignments.map((row) => row.userId)).toEqual(['admin-1'])
    expect(result.eligibleManagers).toEqual([
      { userId: 'admin-1', role: 'AccountAdmin', propertyAccessScope: 'organization' },
      {
        userId: 'manager-1',
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
    ])
    expect(result.revision).toBe(1)
    expect(result.responsibilityNeeded).toBe(false)
    const other = await list({ portalId: portalB.id }, adminOf(ORG_B))
    expect(other.assignments.map((row) => row.userId)).toEqual(['admin-b'])
    expect(other.eligibleManagers.map((row) => row.userId)).toEqual(['admin-b'])
    await expect(list({ portalId: portalA.id }, adminOf(ORG_B))).rejects.toMatchObject({
      code: 'portal_not_found',
    })
  })

  it('supports multiple assigned managers without granting access', async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal] })

    const result = await update(
      {
        portalId: portal.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      adminOf(ORG_A),
    )

    expect(result.assignments.map((row) => row.userId)).toEqual(['admin-1', 'manager-1'])
    expect(result).toMatchObject({ revision: 2, becameResponsibilityNeeded: false })
    expect(await revisionOf(portal)).toBe(2)
    expect(await factsOf(ORG_A, 'portal.responsible_managers.updated')).toEqual([
      expect.objectContaining({ portalId: portal.id, assignmentCount: 2 }),
    ])
  })

  it('rejects a manager without a current grant for the Property, changing nothing', async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal] })

    await expect(
      update(
        {
          portalId: portal.id,
          managerUserIds: ['manager-no-grant'],
          expectedRevision: 1,
        },
        adminOf(ORG_A),
      ),
    ).rejects.toMatchObject(INELIGIBLE)

    expect(await activeOf(portal)).toEqual(['admin-1'])
    expect(await revisionOf(portal)).toBe(1)
    expect(await factsOf(ORG_A, 'portal.responsible_managers.updated')).toEqual([])
  })

  it("does not let another organization's admin change the managers, or a stale revision save", async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal] })

    await expect(
      update(
        { portalId: portal.id, managerUserIds: ['admin-b'], expectedRevision: 1 },
        adminOf(ORG_B),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    await expect(
      update(
        { portalId: portal.id, managerUserIds: ['admin-1'], expectedRevision: 7 },
        adminOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    expect(await activeOf(portal)).toEqual(['admin-1'])
    expect(await revisionOf(portal)).toBe(1)
  })

  it('releases a manager removed while the save committed, keeps the others and refuses the save', async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal], removedWhileSaving: ['manager-1'] })

    await expect(
      update(
        {
          portalId: portal.id,
          managerUserIds: ['admin-1', 'manager-1'],
          expectedRevision: 1,
        },
        adminOf(ORG_A),
      ),
    ).rejects.toMatchObject(INELIGIBLE)

    expect(await activeOf(portal)).toEqual(['admin-1'])
    // The clock has not moved since the assignment: the interval ends after it began.
    expect(
      (await assignmentsOf(portal)).find((row) => row.user_id === 'manager-1'),
    ).toMatchObject({
      effective_from: NOW,
      effective_to: new Date(NOW.getTime() + 1),
      end_reason: 'manager_became_ineligible',
    })
    // Nobody chose this gap, and one manager is left, so no urgent notice goes out.
    expect(await factsOf(ORG_A, 'portal.responsibility_became_needed')).toEqual([])
    expect(await factsOf(ORG_A, 'portal.responsible_managers.updated')).toHaveLength(2)
  })

  it('releases nobody when every assigned manager is still eligible after the commit', async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal] })

    await update(
      {
        portalId: portal.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      adminOf(ORG_A),
    )

    expect(await activeOf(portal)).toEqual(['admin-1', 'manager-1'])
    expect((await assignmentsOf(portal)).every((row) => row.end_reason === null)).toBe(
      true,
    )
  })

  it('reports the transition only when the last manager is removed', async () => {
    const portal = await seedPortal(ORG_A)
    const { update } = wire({ granted: [portal] })
    const ctx = adminOf(ORG_A)

    const first = await update(
      { portalId: portal.id, managerUserIds: [], expectedRevision: 1 },
      ctx,
    )
    const second = await update(
      { portalId: portal.id, managerUserIds: [], expectedRevision: 2 },
      ctx,
    )

    expect(first.becameResponsibilityNeeded).toBe(true)
    expect(second.becameResponsibilityNeeded).toBe(false)
    expect(await factsOf(ORG_A, 'portal.responsibility_became_needed')).toHaveLength(1)
  })
})

describe.sequential(
  'Portal Contact Request manager authority facts (real PostgreSQL)',
  () => {
    it('returns only exact creator and currently eligible assigned-manager facts', async () => {
      const portal = await seedPortal(ORG_A, ['manager-1', 'stale-manager'])
      const { authorityFacts } = wire({ granted: [portal] })

      await expect(authorityFacts(ORG_A, portal.id)).resolves.toEqual({
        propertyId: portal.propertyId,
        creatorUserId: CREATOR,
        responsibleManagerUserIds: ['manager-1'],
      })
    })

    it('returns null when the exact Portal is absent, or belongs to another organization', async () => {
      const portal = await seedPortal(ORG_A, ['manager-1'])
      const { authorityFacts } = wire({ granted: [portal] })

      await expect(authorityFacts(ORG_A, portalId(randomUUID()))).resolves.toBeNull()
      await expect(authorityFacts(ORG_B, portal.id)).resolves.toBeNull()
    })
  },
)
