// Portal context — createPortalGroup use case tests
import { describe, it, expect } from 'vitest'
import { createPortalGroup } from './create-portal-group'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import { organizationId, portalGroupId, propertyId } from '#/shared/domain/ids'

const FIXED_ID = portalGroupId('group-0000-0000-4000-8000-000000000001')
const FIXED_TIME = new Date('2026-05-30T12:00:00Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')

function setup(nameTaken = false) {
  const events = createCapturingEventBus()
  const useCase = createPortalGroup({
    groupRepo: {
      findById: async () => null,
      listByProperty: async () => [],
      findByNameDuplicate: async () =>
        nameTaken
          ? {
              id: portalGroupId('existing'),
              organizationId: ORG,
              propertyId: PROP,
              name: 'Reception',
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      insert: async (g) => g,
      update: async (g) => g,
      delete: async () => {},
    },
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  })
  return { useCase, events }
}

describe('createPortalGroup (use case)', () => {
  it('creates a portal group and emits PortalGroupCreated event', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { name: 'Reception', propertyId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result.id).toBe(FIXED_ID)
    expect(result.name).toBe('Reception')
    expect(result.organizationId).toBe(ORG)
    expect(result.propertyId).toBe(PROP)

    expect(events.capturedByTag('portal.portal_group.created')).toHaveLength(1)
  })

  it('rejects duplicate group name', async () => {
    const { useCase } = setup(true)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    try {
      await useCase(
        { name: 'Reception', propertyId: 'a0000000-0000-4000-8000-000000000001' },
        ctx,
      )
      expect.fail('Expected group_name_taken')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('group_name_taken')
    }
  })

  it('rejects when Staff lacks portal.create', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    try {
      await useCase(
        { name: 'Reception', propertyId: 'a0000000-0000-4000-8000-000000000001' },
        ctx,
      )
      expect.fail('Expected forbidden')
    } catch (e) {
      expect(isPortalError(e)).toBe(true)
      if (isPortalError(e)) expect(e.code).toBe('forbidden')
    }
  })
})
