// Portal context — saving the Property look (the page's accent, background and
// wordmark). What this pins: only an Account Admin may save it, a colour that
// is not a colour or a manual background light text cannot be read on is
// refused before anything persists, an accent that is hard to see on its field
// is NOT refused (the guest page draws light text in its place, and the default
// palette every Property starts with is such an accent), the writer is asked
// for the look facets alone and so never touches the name, the images or who
// confirmed the name, and a Property with no Brand Profile yet is told to set
// its name first.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type {
  PortalExperienceRepository,
  PropertyPortalBrandProfile,
} from '../ports/portal-experience.repository'
import { DEFAULT_PROPERTY_BRAND_PALETTE } from '../../domain/portal-experience'
import { savePropertyLook } from './save-property-look'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const CURRENT: PropertyPortalBrandProfile = {
  id: 'e0000000-0000-4000-8000-000000000001',
  organizationId: ORG,
  propertyId: PROPERTY,
  displayName: 'Avela Resort',
  logoUrl: 'https://cdn.example.com/logo.png',
  defaultHeroImageUrl: 'https://cdn.example.com/hero.png',
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  wordmark: null,
  backgroundMode: 'auto',
  defaultGuestLocales: ['en'],
  lookVersion: 2,
  version: 3,
  updatedBy: 'user-1' as never,
  createdAt: NOW,
  updatedAt: NOW,
}

const setup = (profile: PropertyPortalBrandProfile | null = CURRENT) => {
  const experienceRepo = {
    savePropertyLook: vi.fn<PortalExperienceRepository['savePropertyLook']>(
      async (input) =>
        profile === null
          ? null
          : {
              ...profile,
              primaryColor: input.look.primaryColor,
              backgroundMode: input.look.backgroundMode,
              backgroundColor: input.look.backgroundColor ?? profile.backgroundColor,
              wordmark:
                input.look.wordmark === undefined
                  ? profile.wordmark
                  : input.look.wordmark,
              lookVersion: profile.lookVersion + 1,
            },
    ),
  }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const save = savePropertyLook({
    experienceRepo,
    staffPublicApi,
    clock: () => NOW,
  })
  return { experienceRepo, save }
}

const lookOf = (experienceRepo: ReturnType<typeof setup>['experienceRepo'], call = 0) =>
  experienceRepo.savePropertyLook.mock.calls[call]?.[0]

const admin = () => buildTestAuthContext({ role: 'AccountAdmin' })

describe('savePropertyLook', () => {
  it('hands the writer the accent in upper case and the look alone, as the admin', async () => {
    const { experienceRepo, save } = setup()

    await save(
      { propertyId: PROPERTY, accentColour: '#ead6a8', backgroundMode: 'auto' },
      admin(),
    )

    expect(experienceRepo.savePropertyLook).toHaveBeenCalledOnce()
    const call = lookOf(experienceRepo)
    expect(call).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
      look: { primaryColor: '#EAD6A8', backgroundMode: 'auto' },
      actorUserId: admin().userId,
      at: NOW,
    })
    // The name, images, text colour and "who confirmed the name" are not the
    // look's to write: the writer has no field for them.
    expect(call).not.toHaveProperty('profile')
    expect(call).not.toHaveProperty('updatedBy')
    expect(call?.look).not.toHaveProperty('displayName')
    expect(call?.look).not.toHaveProperty('logoUrl')
    expect(call?.look).not.toHaveProperty('textColor')
  })

  it('saves the default palette accent, which is hard to see on its field, when only the wordmark changes', async () => {
    const { experienceRepo, save } = setup({
      ...CURRENT,
      primaryColor: DEFAULT_PROPERTY_BRAND_PALETTE.primaryColor,
      backgroundColor: DEFAULT_PROPERTY_BRAND_PALETTE.backgroundColor,
    })

    await save(
      {
        propertyId: PROPERTY,
        accentColour: DEFAULT_PROPERTY_BRAND_PALETTE.primaryColor,
        backgroundMode: 'auto',
        wordmark: 'AVELA',
      },
      admin(),
    )

    expect(lookOf(experienceRepo)?.look).toMatchObject({
      primaryColor: '#2563EB',
      wordmark: 'AVELA',
    })
  })

  it.each(['#DC2626', '#7C3AED', '#0F766E', '#6366F1'])(
    'does not refuse the accent %s for being hard to see on its field',
    async (accent) => {
      const { experienceRepo, save } = setup()

      await save(
        { propertyId: PROPERTY, accentColour: accent, backgroundMode: 'auto' },
        admin(),
      )

      expect(lookOf(experienceRepo)?.look.primaryColor).toBe(accent)
    },
  )

  it('stores a manual background that light text can be read on', async () => {
    const { experienceRepo, save } = setup()

    await save(
      {
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'manual',
        backgroundColour: '#1b1410',
      },
      admin(),
    )

    expect(lookOf(experienceRepo)?.look).toMatchObject({
      backgroundMode: 'manual',
      backgroundColor: '#1B1410',
    })
  })

  it('sends no background colour while the background is automatic', async () => {
    const { experienceRepo, save } = setup()

    await save(
      {
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'auto',
        backgroundColour: '#000000',
      },
      admin(),
    )

    expect(lookOf(experienceRepo)?.look).not.toHaveProperty('backgroundColor')
  })

  it('normalises the wordmark, and clears it when it is only spaces', async () => {
    const { experienceRepo, save } = setup()

    await save(
      {
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'auto',
        wordmark: '  AVELA ',
      },
      admin(),
    )
    await save(
      {
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'auto',
        wordmark: '   ',
      },
      admin(),
    )

    expect(lookOf(experienceRepo, 0)?.look.wordmark).toBe('AVELA')
    expect(lookOf(experienceRepo, 1)?.look.wordmark).toBeNull()
  })

  it('leaves the wordmark alone when the caller names none', async () => {
    const { experienceRepo, save } = setup()

    await save(
      { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
      admin(),
    )

    expect(lookOf(experienceRepo)?.look).not.toHaveProperty('wordmark')
  })

  it('refuses a wordmark past 24 characters', async () => {
    const { experienceRepo, save } = setup()

    await expect(
      save(
        {
          propertyId: PROPERTY,
          accentColour: '#EAD6A8',
          backgroundMode: 'auto',
          wordmark: 'A'.repeat(25),
        },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(experienceRepo.savePropertyLook).not.toHaveBeenCalled()
  })

  it('refuses a manual background that light text cannot be read on', async () => {
    const { experienceRepo, save } = setup()

    await expect(
      save(
        {
          propertyId: PROPERTY,
          accentColour: '#EAD6A8',
          backgroundMode: 'manual',
          backgroundColour: '#E8E8E8',
        },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(experienceRepo.savePropertyLook).not.toHaveBeenCalled()
  })

  it('refuses a manual background that is not given or is not a colour', async () => {
    const { save } = setup()

    await expect(
      save(
        {
          propertyId: PROPERTY,
          accentColour: '#EAD6A8',
          backgroundMode: 'manual',
        },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    await expect(
      save(
        {
          propertyId: PROPERTY,
          accentColour: 'gold',
          backgroundMode: 'auto',
        },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
  })

  it('asks the Property to set its public display name first when it has no profile', async () => {
    const { save } = setup(null)

    await expect(
      save(
        { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
  })

  it('refuses a PropertyManager, who holds portal.update but not portal.admin', async () => {
    const { experienceRepo, save } = setup()

    await expect(
      save(
        { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.savePropertyLook).not.toHaveBeenCalled()
  })
})
