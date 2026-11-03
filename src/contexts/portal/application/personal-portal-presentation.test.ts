import { describe, expect, it, vi } from 'vitest'
import { userId } from '#/shared/domain/ids'
import { buildTestPortal } from '#/shared/testing/fixtures'
import {
  immersiveSnapshot,
  immersiveConfiguration,
} from './__fixtures__/immersive-snapshot'
import {
  personalPortalWords,
  personalPortalLook,
  type PersonalPortalPresentationDeps,
} from './personal-portal-presentation'

function fixture() {
  const configuration = immersiveConfiguration()
  const deps: PersonalPortalPresentationDeps = {
    publicationRepo: {
      findActiveForPortal: vi.fn(async () => immersiveSnapshot(configuration)),
    },
    experienceRepo: {
      getPropertyExperience: vi.fn(async () => ({ profile: null, content: [] })),
    },
    mediaRepo: { findById: async () => null },
    mediaUrls: vi.fn(async () => ({})),
    wordingRepo: { find: vi.fn(async () => null) },
    lastPrintRepo: { find: vi.fn(async () => null) },
    finalKitEnabled: true,
  }
  return {
    deps,
    configuration,
    portal: buildTestPortal({ publicationState: 'published' }),
  }
}
describe('personal Portal presentation', () => {
  it('uses only the published brand and currently servable media with focal points', async () => {
    const { deps, portal, configuration } = fixture()
    const hero = configuration.brandProfile.hero!
    vi.mocked(deps.mediaUrls).mockResolvedValue({ [hero.assetId]: '/media/hero' })
    const look = await personalPortalLook(deps, portal)
    expect(look).toMatchObject({
      displayName: configuration.brandProfile.displayName,
      accentColour: configuration.brandProfile.accentColour,
      hero: { url: '/media/hero', focalX: hero.focalX, focalY: hero.focalY },
    })
    expect(look.logo).toBeNull()
    expect(deps.experienceRepo.getPropertyExperience).not.toHaveBeenCalled()
  })
  it('uses the default look for a paused Portal with no Property look', async () => {
    const { deps, portal } = fixture()
    const look = await personalPortalLook(deps, {
      ...portal,
      publicationState: 'disabled',
    })
    expect(look).toMatchObject({ accentColour: '#EAD6A8', hero: null, logo: null })
    expect(deps.publicationRepo.findActiveForPortal).not.toHaveBeenCalled()
    expect(deps.experienceRepo.getPropertyExperience).toHaveBeenCalledWith(
      portal.organizationId,
      portal.propertyId,
    )
  })
  it('falls back to the Property look when paused or nothing is published', async () => {
    const { deps, portal } = fixture()
    vi.mocked(deps.publicationRepo.findActiveForPortal).mockResolvedValue(null)
    vi.mocked(deps.experienceRepo.getPropertyExperience).mockResolvedValue({
      content: [],
      profile: {
        id: 'profile',
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        updatedBy: userId('manager'),
        createdAt: new Date(),
        updatedAt: new Date(),
        displayName: 'Harbor Bistro',
        wordmark: 'Harbor',
        primaryColor: '#E58B6B',
        backgroundColor: '#170E0B',
        backgroundMode: 'manual',
        textColor: '#FFFFFF',
        logoUrl: null,
        defaultHeroImageUrl: null,
        version: 1,
        lookVersion: 2,
        defaultGuestLocales: ['en'],
        logoAssetId: null,
        heroAssetId: null,
        heroFocalX: null,
        heroFocalY: null,
      },
    })
    for (const publicationState of ['published', 'disabled'] as const) {
      expect(
        await personalPortalLook(deps, { ...portal, publicationState }),
      ).toMatchObject({
        displayName: 'Harbor Bistro',
        accentColour: '#E58B6B',
        fieldColour: '#170E0B',
        wordmark: 'Harbor',
      })
    }
  })
  it('uses the last print wording when none was saved', async () => {
    const { deps, portal } = fixture()
    vi.mocked(deps.lastPrintRepo.find).mockResolvedValue({
      printedAt: new Date(),
      photo: null,
      settings: {
        piece: 'tent',
        orientation: 'wide',
        look: 'immersive',
        paper: 'letter',
        printer: 'my_printer',
        quantity: 1,
        fillSpares: false,
        perSheet: null,
        cropMarks: false,
        backPage: false,
        languages: ['en'],
        callToAction: 'how_was_stay',
        customWords: null,
      },
    })
    expect((await personalPortalWords(deps, portal, 'en')).headline).toBe(
      'How was your stay?',
    )
  })
  it('resolves a saved preset, custom words in the primary language, and the default', async () => {
    const { deps, portal } = fixture()
    expect((await personalPortalWords(deps, portal, 'en')).headline).toBe(
      'How did we do?',
    )
    vi.mocked(deps.wordingRepo.find).mockResolvedValue({
      callToAction: 'how_was_stay',
      customWords: null,
    })
    expect((await personalPortalWords(deps, portal, 'en')).headline).toBe(
      'How was your stay?',
    )
    vi.mocked(deps.wordingRepo.find).mockResolvedValue({
      callToAction: 'how_was_stay',
      customWords: { bg: { headline: 'Как беше вечерята?', subline: 'Благодарим' } },
    })
    const bg = await personalPortalWords(deps, portal, 'bg')
    expect(bg.headline).toBe('Как беше вечерята?')
    expect(bg.subline).toBe('Благодарим')
    expect(
      await personalPortalWords({ ...deps, finalKitEnabled: false }, portal, 'en'),
    ).toEqual({
      headline: 'How did we do?',
      subline: 'About 30 seconds',
      cue: 'Scan with your camera',
    })
  })
})
