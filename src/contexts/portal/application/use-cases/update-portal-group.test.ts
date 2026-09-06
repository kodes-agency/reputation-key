// Portal context — updatePortalGroup use case tests
import { describe, it, expect } from 'vitest'
import { updatePortalGroup } from './update-portal-group'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
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
const CURRENT_REVISION = new Date('2026-06-01T12:00:00Z')
const NEXT_REVISION = new Date(CURRENT_REVISION.getTime() + 1)
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
  updatedAt: CURRENT_REVISION,
  deletedAt: null,
}

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(notFound = false, accessible: ReadonlyArray<PropertyId> | null = null) {
  const outbox = createRecordedOutbox()
  const portalGroupRepo = {
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
    findGroupIdsByPortalIds: async () => [],
    findGroupForPortal: async () => null,
  }
  const useCase = updatePortalGroup({
    portalGroupRepo,
    commandStore: createInMemoryPortalCommandStore({
      portalRepo: createInMemoryPortalRepo(),
      portalGroupRepo,
      outbox,
    }),
    clock: () => FIXED_TIME,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, outbox }
}

describe('updatePortalGroup (use case)', () => {
  it('updates the group name and records PortalGroupUpdated', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New Name' },
      ctx,
    )

    expect(result).toMatchObject({ name: 'New Name', updatedAt: NEXT_REVISION })
    expect(outbox.byTag('portal_group.updated')).toEqual([
      expect.objectContaining({
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: FIXED_TIME,
      }),
    ])
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
    const { useCase, outbox } = setup(false, [
      propertyId('a0000000-0000-4000-8000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalGroupId: 'group-0000-0000-4000-8000-000000000001', name: 'New Name' },
      ctx,
    )

    expect(result.name).toBe('New Name')
    expect(outbox.byTag('portal_group.updated')).toHaveLength(1)
  })
})
