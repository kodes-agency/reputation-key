// Portal context — updatePortalGroup use case tests
import { describe, it, expect } from 'vitest'
import { updatePortalGroup } from './update-portal-group'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  organizationId,
  portalGroupId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const FIXED_TIME = new Date('2026-05-30T12:00:00Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')
const GROUP_ID = portalGroupId('group-0000-0000-4000-8000-000000000001')

const existing = {
  id: GROUP_ID,
  organizationId: ORG,
  propertyId: PROP,
  name: 'Old Name',
  sortKey: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  updatedAt: new Date('2026-05-01T00:00:00Z'),
  deletedAt: null,
}

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

function setup(notFound = false, accessible: ReadonlyArray<PropertyId> | null = null) {
  const events = createCapturingEventBus()
  const useCase = updatePortalGroup({
    portalGroupRepo: {
      findById: async () => (notFound ? null : existing),
      listByProperty: async () => [],
      nameExists: async () => false,
      insert: async () => {},
      update: async () => {},
      softDelete: async () => {},
      addPortal: async () => {},
      removePortal: async () => false,
      findPortalMembership: async () => null,
      getGroupPortalIds: async () => [],
      findGroupForPortal: async () => null,
    },
    events,
    clock: () => FIXED_TIME,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, events }
}

describe('updatePortalGroup (use case)', () => {
  it('updates group name and emits PortalGroupUpdated', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New Name' },
      ctx,
    )

    expect(result.name).toBe('New Name')
    expect(events.capturedByTag('portal_group.updated')).toHaveLength(1)
  })

  it('throws not_found for nonexistent group', async () => {
    const { useCase } = setup(true)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    try {
      await useCase(
        { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New' },
        ctx,
      )
      expect.fail('Expected not_found')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('group_not_found')
    }
  })

  it('rejects when Staff lacks portal.update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    try {
      await useCase(
        { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New' },
        ctx,
      )
      expect.fail('Expected forbidden')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('forbidden')
    }
  })
  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase } = setup(false, [])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    try {
      await useCase(
        { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New' },
        ctx,
      )
      expect.fail('Expected forbidden')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('forbidden')
    }
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, events } = setup(false, [
      propertyId('a0000000-0000-4000-8000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New Name' },
      ctx,
    )

    expect(result.name).toBe('New Name')
    expect(events.capturedByTag('portal_group.updated')).toHaveLength(1)
  })
})
