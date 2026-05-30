// Portal context — deletePortalGroup use case tests
import { describe, it, expect } from 'vitest'
import { deletePortalGroup } from './delete-portal-group'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import { organizationId, portalGroupId, propertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-30T12:00:00Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')
const GROUP_ID = portalGroupId('group-0000-0000-4000-8000-000000000001')

function setup(notFound = false) {
  const events = createCapturingEventBus()
  const useCase = deletePortalGroup({
    groupRepo: {
      findById: async () =>
        notFound
          ? null
          : { id: GROUP_ID, organizationId: ORG, propertyId: PROP, name: 'To Delete', createdAt: new Date(), updatedAt: new Date() },
      listByProperty: async () => [],
      findByNameDuplicate: async () => null,
      insert: async (g) => g,
      update: async (g) => g,
      delete: async () => {},
    },
    events,
    clock: () => FIXED_TIME,
  })
  return { useCase, events }
}

describe('deletePortalGroup (use case)', () => {
  it('deletes group and emits PortalGroupDeleted', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { groupId: 'group-0000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(events.capturedByTag('portal_group.deleted')).toHaveLength(1)
  })

  it('throws not_found for nonexistent group', async () => {
    const { useCase } = setup(true)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    try {
      await useCase(
        { groupId: 'group-0000-0000-4000-8000-000000000001' },
        ctx,
      )
      expect.fail('Expected not_found')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('group_not_found')
    }
  })

  it('rejects when Staff lacks portal.delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    try {
      await useCase(
        { groupId: 'group-0000-0000-4000-8000-000000000001' },
        ctx,
      )
      expect.fail('Expected forbidden')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('forbidden')
    }
  })
})
