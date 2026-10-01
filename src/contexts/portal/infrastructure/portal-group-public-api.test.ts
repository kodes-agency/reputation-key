import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalGroupRepository } from '../application/ports/portal-group.repository'
import { createPortalGroupPublicApi } from './portal-group-public-api'

const org = organizationId('org-1')
const prop = propertyId('prop-1')
const portal = portalId('portal-1')
const group = portalGroupId('group-1')
const NOW = new Date('2026-10-01T00:00:00Z')

const build = (repo: Partial<PortalGroupRepository>) =>
  createPortalGroupPublicApi(repo as PortalGroupRepository, () => NOW)

describe('createPortalGroupPublicApi', () => {
  it('reads the group of a Portal as of now when no time is given', async () => {
    const findGroupForPortal = vi.fn(async () => ({
      id: group,
      propertyId: prop,
      name: 'North',
      sortKey: 'a',
    }))
    const api = build({ findGroupForPortal } as never)

    const found = await api.findGroupForPortal(org, portal)

    expect(findGroupForPortal).toHaveBeenCalledWith(org, portal, NOW)
    expect(found).toEqual({ id: group, propertyId: prop, name: 'North' })
  })

  it('returns null when the Portal is in no group', async () => {
    const api = build({ findGroupForPortal: vi.fn(async () => null) } as never)

    expect(await api.findGroupForPortal(org, portal, new Date(0))).toBeNull()
  })

  it('says whether a group belongs to the given Property', async () => {
    const findById = vi.fn(async () => ({ id: group, propertyId: prop }))
    const api = build({ findById } as never)

    expect(await api.portalGroupBelongsToProperty(org, prop, group)).toBe(true)
    expect(await api.portalGroupBelongsToProperty(org, propertyId('other'), group)).toBe(
      false,
    )
  })

  it('says a missing group belongs to no Property', async () => {
    const api = build({ findById: vi.fn(async () => null) } as never)

    expect(await api.portalGroupBelongsToProperty(org, prop, group)).toBe(false)
  })

  it('delegates the member reads to the repository', async () => {
    const getGroupPortalIds = vi.fn(async () => [portal])
    const findGroupIdsByPortalIds = vi.fn(async () => [group])
    const api = build({ getGroupPortalIds, findGroupIdsByPortalIds })

    await api.getGroupPortalIds(org, group)
    await api.findGroupIdsByPortalIds(org, [portal])

    expect(getGroupPortalIds).toHaveBeenCalledWith(org, group)
    expect(findGroupIdsByPortalIds).toHaveBeenCalledWith(org, [portal])
  })
})
