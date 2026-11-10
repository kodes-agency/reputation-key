import type { Page } from '@playwright/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishPortalInputSchema } from '../../src/contexts/portal/application/dto/portal-intents.dto'
import { seedPortalGoalProperty } from './portal-goal-fixtures'
import { seedPortalLookProperty } from './portal-look-fixtures'

const transport = vi.hoisted(() => ({
  callServerFn: vi.fn(),
  callServerFnGet: vi.fn(),
}))

vi.mock('./fixtures', () => ({
  ...transport,
  dbQuery: vi.fn(async () => []),
  e2eRunId: 'publication-fixture',
  getUserByEmail: vi.fn(async () => ({ id: 'manager' })),
  seedProperty: vi.fn(async () => ({ propertyId: 'property' })),
  waitFor: vi.fn(),
}))

vi.mock('./seed-state', () => ({
  requireE2eSeedState: () => ({
    organizationId: 'organization',
    onePropertyManagerEmail: 'manager@example.test',
  }),
}))

// These fixtures use the Page only as the transport's opaque browser handle.
const page = {} as Page

beforeEach(() => {
  vi.clearAllMocks()
  let nextPortal = 0
  const reviewed = new Map<string, string>()
  transport.callServerFnGet.mockImplementation(async (_page, input) => {
    if (input.exportName !== 'getPortalReview') throw new Error('Unexpected read')
    const reviewDigest = `reviewed-${input.data.portalId}`
    reviewed.set(input.data.portalId, reviewDigest)
    return { reviewDigest }
  })
  transport.callServerFn.mockImplementation(async (_page, input) => {
    if (input.exportName === 'createPortal') {
      return { portal: { id: `portal-${++nextPortal}` } }
    }
    if (input.exportName === 'issuePortalToken') return { rawToken: 'address' }
    if (input.exportName === 'publishPortal') {
      const data = publishPortalInputSchema.parse(input.data)
      expect(data.reviewedDigest).toBe(reviewed.get(data.portalId))
      return { portal: { id: data.portalId, publicationState: 'published' } }
    }
    return {}
  })
})

describe('live Portal fixtures', () => {
  it('publishes both look Portals with the digest read for each Portal', async () => {
    const seeded = await seedPortalLookProperty(page, 'look', 0, '#123456')

    expect(seeded.reception.id).not.toBe(seeded.spa.id)
    expect(transport.callServerFnGet).toHaveBeenCalledTimes(2)
  })

  it('publishes all goal Portals with the digest read for each Portal', async () => {
    const seeded = await seedPortalGoalProperty(page, 'goal', 0)

    expect(seeded.portals).toHaveLength(3)
    expect(transport.callServerFnGet).toHaveBeenCalledTimes(3)
  })
})
