// Portal context — create portal group use case tests

import { describe, it, expect } from 'vitest'
import { createPortalGroup } from './create-portal-group'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  portalGroupId,
  portalId,
  propertyId,
  type OrganizationId,
  type PropertyId,
  type PortalGroupId,
} from '#/shared/domain/ids'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'

const FIXED_ID = portalGroupId('pg-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

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

const setup = () => {
  const portalGroupRepo = createInMemoryPortalGroupRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalGroupRepo,
    propertyApi: {
      propertyExists: async (_orgId: OrganizationId, pid: PropertyId) =>
        String(pid) === 'a0000000-0000-0000-0000-000000000001',
      getPropertyName: async () => null,
      findByGbpPlaceId: async () => null,
      findBySlug: async () => null,
      findIdsByGoogleConnection: async () => [],
      clearGoogleConnectionRef: async () => {},
      importProperty: async () => {
        throw new Error('not implemented')
      },
      findExistingGbpPlaceIds: async () => [],
      existsByGbpPlaceId: async () => false,
    },
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }
  const useCase = createPortalGroup(deps)
  return { useCase, portalGroupRepo, events }
}

describe('createPortalGroup', () => {
  it('creates a group with defaults', async () => {
    const { useCase, portalGroupRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const group = await useCase(
      { name: 'My Group', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(group.name).toBe('My Group')
    expect(group.sortKey).toBeNull()
    expect(portalGroupRepo.all()).toHaveLength(1)
  })

  it('rejects forbidden role', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ name: 'Test', propertyId: 'a0000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects duplicate name in same property', async () => {
    const { useCase, portalGroupRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const existing: PortalGroup = {
      id: portalGroupId('pg-existing-0000-0000-000000000001'),
      organizationId: ctx.organizationId,
      propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
      name: 'My Group',
      sortKey: null,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      deletedAt: null,
    }
    portalGroupRepo.seed([existing])

    await expect(
      useCase(
        { name: 'My Group', propertyId: 'a0000000-0000-0000-0000-000000000001' },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'group_name_taken',
    )
  })

  it('adds portals on creation and emits events', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      {
        name: 'Group With Portals',
        propertyId: 'a0000000-0000-0000-0000-000000000001',
        portalIds: ['p-00000000-0000-0000-0000-000000000001'],
      },
      ctx,
    )

    const created = events.capturedByTag('portal_group.created')
    expect(created).toHaveLength(1)
    expect(created[0].name).toBe('Group With Portals')

    const added = events.capturedByTag('portal_group.portal_added')
    expect(added).toHaveLength(1)
  })

  it('emits created event on success without portals', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      { name: 'Solo Group', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    const emitted = events.capturedByTag('portal_group.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('Solo Group')
  })
})
