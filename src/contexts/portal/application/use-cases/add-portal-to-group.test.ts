// Portal context — add portal to group use case tests
// Covers: role authorization (portal.update), property-assignment scoping,
// not_found, portal_already_grouped, and added-event emission.

import { describe, it, expect } from 'vitest'
import { addPortalToGroup } from './add-portal-to-group'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PortalGroupId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const GROUP_ID = portalGroupId('pg-00000000-0000-0000-0000-000000000001')
const PORTAL_ID = portalId('p-00000000-0000-0000-0000-000000000001')
const PROPERTY_ID = propertyId('a0000000-0000-0000-0000-000000000001')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  // null simulates AccountAdmin org-wide bypass; an array simulates PM/Staff scoping.
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const createInMemoryPortalGroupRepo = (): PortalGroupRepository & {
  all(): PortalGroup[]
  seed(groups: PortalGroup[]): void
} => {
  const store = new Map<string, PortalGroup>()
  const memberships = new Map<string, PortalGroupId>()

  return {
    all: () => Array.from(store.values()),
    seed: (groups) => groups.forEach((g) => store.set(String(g.id), g)),

    findById: async (orgId, id) => {
      const g = store.get(String(id))
      return g && String(g.organizationId) === String(orgId) ? g : null
    },
    listByProperty: async (orgId, propertyId) =>
      Array.from(store.values()).filter(
        (g) =>
          String(g.organizationId) === String(orgId) &&
          String(g.propertyId) === String(propertyId),
      ),
    nameExists: async (orgId, propertyId, name, excludeId) =>
      Array.from(store.values()).some(
        (g) =>
          String(g.organizationId) === String(orgId) &&
          String(g.propertyId) === String(propertyId) &&
          g.name === name &&
          (!excludeId || String(g.id) !== String(excludeId)),
      ),
    insert: async (orgId, group) => {
      if (String(group.organizationId) !== String(orgId))
        throw new Error('Tenant mismatch')
      store.set(String(group.id), group)
    },
    update: async (orgId, id, patch) => {
      const g = store.get(String(id))
      if (g && String(g.organizationId) === String(orgId)) {
        store.set(String(id), { ...g, ...patch })
      }
    },
    softDelete: async (orgId, id) => {
      const g = store.get(String(id))
      if (g && String(g.organizationId) === String(orgId)) {
        store.set(String(id), { ...g, deletedAt: new Date() })
      }
    },
    addPortal: async (_orgId, groupId, pid) => {
      memberships.set(String(pid), groupId)
    },
    removePortal: async (_orgId, _groupId, pid) => {
      const existed = memberships.has(String(pid))
      memberships.delete(String(pid))
      return existed
    },
    findPortalMembership: async (_orgId, pid) => memberships.get(String(pid)) ?? null,
    getGroupPortalIds: async (_orgId, groupId) =>
      Array.from(memberships.entries())
        .filter(([, gid]) => String(gid) === String(groupId))
        .map(([pid]) => portalId(pid)),
    findGroupForPortal: async (_orgId, pid) => {
      const gid = memberships.get(String(pid))
      return gid ? (store.get(String(gid)) ?? null) : null
    },
  }
}

const createPortalRepoMock = (portal: Portal | null): PortalRepository =>
  ({
    findById: async () => portal,
  }) as unknown as PortalRepository

const seedPortal = (): Portal => ({
  id: PORTAL_ID,
  organizationId: organizationId('org-test-portal-group-000001'),
  propertyId: PROPERTY_ID,
  entityType: 'property',
  entityId: PROPERTY_ID,
  name: 'Test Portal',
  slug: 'test-portal',
  description: null,
  heroImageUrl: null,
  theme: { primaryColor: '#000000' },
  smartRoutingEnabled: false,
  smartRoutingThreshold: 0,
  isActive: true,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null) => {
  const portalGroupRepo = createInMemoryPortalGroupRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalGroupRepo,
    portalRepo: createPortalRepoMock(seedPortal()),
    staffPublicApi: staffApiMock(accessible),
    events,
    clock: () => FIXED_TIME,
  }
  const useCase = addPortalToGroup(deps)
  return { useCase, portalGroupRepo, events }
}

const seedGroup = (orgId: PortalGroup['organizationId']): PortalGroup => ({
  id: GROUP_ID,
  organizationId: orgId,
  propertyId: PROPERTY_ID,
  name: 'Test Group',
  sortKey: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
})

describe('addPortalToGroup', () => {
  it('adds a portal to a group and emits added event (PM assigned to the property)', async () => {
    const { useCase, portalGroupRepo, events } = setup([PROPERTY_ID])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalGroupRepo.seed([seedGroup(ctx.organizationId)])

    await useCase({ portalGroupId: String(GROUP_ID), portalId: String(PORTAL_ID) }, ctx)

    const membership = await portalGroupRepo.findPortalMembership(
      ctx.organizationId,
      PORTAL_ID,
    )
    expect(String(membership)).toBe(String(GROUP_ID))

    const emitted = events.capturedByTag('portal_group.portal_added')
    expect(emitted).toHaveLength(1)
    expect(String(emitted[0].portalId)).toBe(String(PORTAL_ID))
    expect(String(emitted[0].portalGroupId)).toBe(String(GROUP_ID))
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalGroupRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalGroupRepo.seed([seedGroup(ctx.organizationId)])

    await expect(
      useCase({ portalGroupId: String(GROUP_ID), portalId: String(PORTAL_ID) }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('rejects forbidden role (Staff lacks portal.update)', async () => {
    const { useCase, portalGroupRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'Staff' })
    portalGroupRepo.seed([seedGroup(ctx.organizationId)])

    await expect(
      useCase({ portalGroupId: String(GROUP_ID), portalId: String(PORTAL_ID) }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('rejects group_not_found when the group does not exist', async () => {
    const { useCase } = setup([PROPERTY_ID])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ portalGroupId: String(GROUP_ID), portalId: String(PORTAL_ID) }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'group_not_found')
  })

  it('rejects portal_already_grouped when the portal belongs to a group', async () => {
    const { useCase, portalGroupRepo } = setup([PROPERTY_ID])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalGroupRepo.seed([seedGroup(ctx.organizationId)])

    // Portal is already a member of the group.
    await portalGroupRepo.addPortal(ctx.organizationId, GROUP_ID, PORTAL_ID)

    await expect(
      useCase({ portalGroupId: String(GROUP_ID), portalId: String(PORTAL_ID) }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'portal_already_grouped',
    )
  })
})
