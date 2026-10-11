import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoalProgramSubjectReader } from './goal-program-subject-reader'

const propertyApi = { getPropertyTimezone: vi.fn() }
const portalApi = {
  resolvePortalContext: vi.fn(),
  getPortalInfo: vi.fn(),
  listCurrentPortalIds: vi.fn(),
}
const portalGroupApi = { portalGroupBelongsToProperty: vi.fn(), getGroupInfo: vi.fn() }
const reader = () =>
  createGoalProgramSubjectReader(
    propertyApi as never,
    portalApi as never,
    portalGroupApi as never,
  )

describe('Goal Program subject reader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates timezone and Portal Group ownership through tenant-bound APIs', async () => {
    propertyApi.getPropertyTimezone.mockResolvedValue('Europe/Sofia')
    portalGroupApi.portalGroupBelongsToProperty.mockResolvedValue(true)

    await expect(reader().getTimezone('org-1', 'property-1')).resolves.toBe(
      'Europe/Sofia',
    )
    await expect(
      reader().subjectBelongsToProperty('org-1', 'property-1', {
        kind: 'portal_group',
        portalGroupId: 'group-1',
      }),
    ).resolves.toBe(true)
    expect(portalGroupApi.portalGroupBelongsToProperty).toHaveBeenCalledWith(
      'org-1',
      'property-1',
      'group-1',
    )
  })

  it('accepts a Portal only when both Organization and Property match', async () => {
    portalApi.resolvePortalContext.mockResolvedValue({
      organizationId: 'org-1',
      propertyId: 'property-1',
    })
    portalApi.getPortalInfo.mockResolvedValue({
      id: 'portal-1',
      name: 'Lobby',
      publicationState: 'published',
    })
    const subject = { kind: 'portal' as const, portalId: 'portal-1' }

    await expect(
      reader().subjectBelongsToProperty('org-1', 'property-1', subject),
    ).resolves.toBe(true)
    await expect(
      reader().subjectBelongsToProperty('org-2', 'property-1', subject),
    ).resolves.toBe(false)
  })

  it('does not treat an archived Portal as a current Goal subject', async () => {
    portalApi.resolvePortalContext.mockResolvedValue({
      organizationId: 'org-1',
      propertyId: 'property-1',
    })
    portalApi.getPortalInfo.mockResolvedValue({
      id: 'portal-1',
      name: 'Lobby',
      publicationState: 'archived',
    })

    await expect(
      reader().subjectBelongsToProperty('org-1', 'property-1', {
        kind: 'portal',
        portalId: 'portal-1',
      }),
    ).resolves.toBe(false)
  })

  it('checks Property subjects without cross-context reads', async () => {
    await expect(
      reader().subjectBelongsToProperty('org-1', 'property-1', {
        kind: 'property',
        propertyId: 'property-2',
      }),
    ).resolves.toBe(false)
    expect(portalApi.resolvePortalContext).not.toHaveBeenCalled()
  })

  describe('subject names', () => {
    const lobby = { kind: 'portal' as const, portalId: 'portal-1' }
    const north = { kind: 'portal_group' as const, portalGroupId: 'group-1' }
    const livePortal = (publicationState = 'published') => {
      portalApi.resolvePortalContext.mockResolvedValue({
        organizationId: 'org-1',
        propertyId: 'property-1',
      })
      portalApi.getPortalInfo.mockResolvedValue({
        id: 'portal-1',
        name: 'Lobby',
        publicationState,
      })
    }

    it('names a Portal of the Property', async () => {
      livePortal()

      await expect(reader().getSubjectName('org-1', 'property-1', lobby)).resolves.toBe(
        'Lobby',
      )
      expect(portalApi.getPortalInfo).toHaveBeenCalledWith('org-1', 'portal-1')
    })

    it('names no Portal of another Property, another organization, or the archive', async () => {
      livePortal()
      await expect(
        reader().getSubjectName('org-1', 'property-2', lobby),
      ).resolves.toBeNull()
      await expect(
        reader().getSubjectName('org-2', 'property-1', lobby),
      ).resolves.toBeNull()

      livePortal('archived')
      await expect(
        reader().getSubjectName('org-1', 'property-1', lobby),
      ).resolves.toBeNull()
    })

    it('names a Portal Group of the Property, and none of another Property', async () => {
      portalGroupApi.getGroupInfo.mockResolvedValue({
        id: 'group-1',
        propertyId: 'property-1',
        name: 'North wing',
      })

      await expect(reader().getSubjectName('org-1', 'property-1', north)).resolves.toBe(
        'North wing',
      )
      await expect(
        reader().getSubjectName('org-1', 'property-2', north),
      ).resolves.toBeNull()
      expect(portalGroupApi.getGroupInfo).toHaveBeenCalledWith('org-1', 'group-1')
    })

    it('names no group the organization does not have', async () => {
      portalGroupApi.getGroupInfo.mockResolvedValue(null)

      await expect(
        reader().getSubjectName('org-1', 'property-1', north),
      ).resolves.toBeNull()
    })
  })

  it('takes a bounded current-Portal snapshot through the Portal owner', async () => {
    portalApi.listCurrentPortalIds.mockResolvedValue(['portal-1', 'portal-2'])

    await expect(
      reader().listCurrentPortalIds('org-1', 'property-1', 251),
    ).resolves.toEqual(['portal-1', 'portal-2'])
    expect(portalApi.listCurrentPortalIds).toHaveBeenCalledWith(
      'org-1',
      'property-1',
      251,
    )
  })
})
