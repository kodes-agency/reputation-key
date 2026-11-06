import { QueryClient } from '@tanstack/react-query'
import { isNotFound } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({
  listPortals: vi.fn(),
  getPortal: vi.fn(),
  getPropertyPortalExperience: vi.fn(),
  getPortalPublicationHistory: vi.fn(),
  listPortalApprovedDestinations: vi.fn(),
  getPortalLinktree: vi.fn(),
  listPortalLinks: vi.fn(),
  getPortalReview: vi.fn(),
  getPortalLanguageCoverage: vi.fn(),
  listPortalGroups: vi.fn(),
  listPortalResponsibleManagers: vi.fn(),
  listMembers: vi.fn(),
}))

vi.mock('#/contexts/portal/server/portals', () => ({
  listPortals: reads.listPortals,
  getPortal: reads.getPortal,
  getPropertyPortalExperience: reads.getPropertyPortalExperience,
  getPortalPublicationHistory: reads.getPortalPublicationHistory,
  listPortalApprovedDestinations: reads.listPortalApprovedDestinations,
}))
vi.mock('#/contexts/portal/server/portal-links', () => ({
  getPortalLinktree: reads.getPortalLinktree,
  listPortalLinks: reads.listPortalLinks,
}))
vi.mock('#/contexts/portal/server/portal-review', () => ({
  getPortalReview: reads.getPortalReview,
}))
vi.mock('#/contexts/portal/server/portal-language-coverage', () => ({
  getPortalLanguageCoverage: reads.getPortalLanguageCoverage,
}))
vi.mock('#/contexts/portal/server/portal-groups', () => ({
  listPortalGroups: reads.listPortalGroups,
}))
vi.mock('#/contexts/portal/server/portal-responsible-managers', () => ({
  listPortalResponsibleManagers: reads.listPortalResponsibleManagers,
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  membersQuery: () => ({
    queryKey: ['members-test'],
    queryFn: () => reads.listMembers(),
    staleTime: 30_000,
  }),
  propertyQuery: (propertyId: string) => ({
    queryKey: ['property-test', propertyId],
    queryFn: () => Promise.resolve({ property: { id: propertyId } }),
  }),
}))

import { loadPortalWorkspace, portalQuery } from './-portal-detail-data'

const PROPERTY = 'property-1'
const PORTAL = 'portal-1'

const DETAIL_READS = [
  reads.getPortal,
  reads.listPortalLinks,
  reads.getPortalLanguageCoverage,
  reads.getPortalLinktree,
  reads.listPortalGroups,
  reads.listPortalResponsibleManagers,
  reads.listMembers,
  reads.getPortalPublicationHistory,
  reads.getPropertyPortalExperience,
  reads.listPortalApprovedDestinations,
] as const

function listing(ids: readonly string[]) {
  return { portals: ids.map((id) => ({ id })) }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

describe('loadPortalWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    reads.listPortals.mockResolvedValue(listing([PORTAL]))
    for (const read of DETAIL_READS) read.mockResolvedValue({ ok: true })
  })

  it('waits for authorization before starting any portal detail read', async () => {
    // Arrange: a list that stays out until we say so.
    let releaseList: (value: unknown) => void = () => undefined
    reads.listPortals.mockReturnValue(
      new Promise((resolve) => {
        releaseList = resolve
      }),
    )

    // Act
    const loading = loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL)
    await Promise.resolve()

    // No detail endpoint may probe a portal outside the authorized collection.
    expect(reads.listPortals).toHaveBeenCalledOnce()
    for (const read of DETAIL_READS) expect(read).not.toHaveBeenCalled()
    releaseList(listing([PORTAL]))
    await loading
  })

  it('fills the cache for a portal in the list', async () => {
    const queryClient = new QueryClient()

    await loadPortalWorkspace(queryClient, PROPERTY, PORTAL)

    expect(queryClient.getQueryData(portalQuery(PORTAL).queryKey)).toEqual({ ok: true })
    expect(reads.getPortal).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(['members-test'])).toBeUndefined()
  })

  it('says not found for a portal that is absent, even when other reads failed', async () => {
    reads.listPortals.mockResolvedValue(listing(['another-portal']))
    reads.getPortal.mockRejectedValue(new Error('forbidden'))
    reads.listPortalLinks.mockRejectedValue(new Error('forbidden'))

    const error = await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))

    // No read's failure tells a portal of another property from a removed one.
    expect(isNotFound(error)).toBe(true)
    for (const read of DETAIL_READS) expect(read).not.toHaveBeenCalled()
  })

  it('refetches the list once before concluding the portal is gone', async () => {
    reads.listPortals.mockResolvedValue(listing([]))

    const error = await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))

    expect(isNotFound(error)).toBe(true)
    expect(reads.listPortals).toHaveBeenCalledTimes(2)
  })

  it('finds a portal created since the list was cached, on the second look', async () => {
    reads.listPortals
      .mockResolvedValueOnce(listing([]))
      .mockResolvedValueOnce(listing([PORTAL]))

    await expect(
      loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL),
    ).resolves.toBeUndefined()
  })

  it('resolves entry without starting ancillary reads that would reject', async () => {
    const first = new Error('links failed')
    reads.listPortalLinks.mockRejectedValue(first)
    reads.getPortalLinktree.mockRejectedValue(new Error('linktree failed'))

    const error = await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))

    expect(error).toBeUndefined()
    expect(reads.listPortalLinks).not.toHaveBeenCalled()
    expect(reads.getPortalLinktree).not.toHaveBeenCalled()
  })

  it('preserves the detail failure after authorization', async () => {
    const failure = new Error('detail failed')
    reads.getPortal.mockRejectedValue(failure)
    expect(await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))).toBe(
      failure,
    )
  })

  it('rethrows the list failing, not not-found', async () => {
    const failure = new Error('list failed')
    reads.listPortals.mockRejectedValue(failure)

    const error = await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))

    expect(error).toBe(failure)
  })

  it('resolves entry without waiting for pending ancillary reads', async () => {
    let finished = false
    reads.getPortalLinktree.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            finished = true
            resolve({ ok: true })
          }, 20),
        ),
    )
    reads.listPortalLinks.mockRejectedValue(new Error('links failed'))

    await caught(loadPortalWorkspace(new QueryClient(), PROPERTY, PORTAL))

    expect(finished).toBe(false)
    expect(reads.getPortalLinktree).not.toHaveBeenCalled()
  })
})
