// Portal context — saving the Property look (the page's accent, background and
// wordmark). What this pins: only an Account Admin may save it, a look the
// guest page could not read is refused before anything persists, the writer
// is handed the profile's own name and server-owned images (a look save never
// clears them), and a Property with no Brand Profile yet is told to set its
// name first.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type {
  PortalExperienceRepository,
  PropertyPortalBrandProfile,
} from '../ports/portal-experience.repository'
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
    getPropertyExperience: vi.fn<PortalExperienceRepository['getPropertyExperience']>(
      async () => ({ profile, content: [] }),
    ),
    savePropertyProfile: vi.fn<PortalExperienceRepository['savePropertyProfile']>(
      async (input) => ({
        ...CURRENT,
        ...input.profile,
        wordmark: input.profile.wordmark ?? CURRENT.wordmark,
        backgroundMode: input.profile.backgroundMode ?? CURRENT.backgroundMode,
        lookVersion: CURRENT.lookVersion + 1,
      }),
    ),
  }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const save = savePropertyLook({
    experienceRepo,
    staffPublicApi,
    idGen: () => 'e0000000-0000-4000-8000-000000000009',
    clock: () => NOW,
  })
  return { experienceRepo, save }
}

const admin = () => buildTestAuthContext({ role: 'AccountAdmin' })

describe('savePropertyLook', () => {
  it('saves the accent in upper case and keeps the name, images and text colour', async () => {
    const { experienceRepo, save } = setup()

    await save(
      { propertyId: PROPERTY, accentColour: '#ead6a8', backgroundMode: 'auto' },
      admin(),
    )

    expect(experienceRepo.savePropertyProfile).toHaveBeenCalledOnce()
    const [call] = experienceRepo.savePropertyProfile.mock.calls[0] ?? []
    expect(call?.profile).toMatchObject({
      displayName: 'Avela Resort',
      logoUrl: 'https://cdn.example.com/logo.png',
      defaultHeroImageUrl: 'https://cdn.example.com/hero.png',
      primaryColor: '#EAD6A8',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
      backgroundMode: 'auto',
    })
    expect(call?.updatedBy).toBe(admin().userId)
  })

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

    const [call] = experienceRepo.savePropertyProfile.mock.calls[0] ?? []
    expect(call?.profile).toMatchObject({
      backgroundMode: 'manual',
      backgroundColor: '#1B1410',
    })
  })

  it('keeps the stored background colour while the background is automatic', async () => {
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

    const [call] = experienceRepo.savePropertyProfile.mock.calls[0] ?? []
    expect(call?.profile.backgroundColor).toBe('#FFFFFF')
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

    expect(experienceRepo.savePropertyProfile.mock.calls[0]?.[0].profile.wordmark).toBe(
      'AVELA',
    )
    expect(
      experienceRepo.savePropertyProfile.mock.calls[1]?.[0].profile.wordmark,
    ).toBeNull()
  })

  it('leaves the wordmark alone when the caller names none', async () => {
    const { experienceRepo, save } = setup()

    await save(
      { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
      admin(),
    )

    expect(
      experienceRepo.savePropertyProfile.mock.calls[0]?.[0].profile,
    ).not.toHaveProperty('wordmark')
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
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
  })

  it('refuses an accent that is hard to see on the page background', async () => {
    const { experienceRepo, save } = setup()

    await expect(
      save(
        { propertyId: PROPERTY, accentColour: '#1A1A2E', backgroundMode: 'auto' },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
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
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
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
    const { experienceRepo, save } = setup(null)

    await expect(
      save(
        { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
  })

  it('refuses a PropertyManager, who holds portal.update but not portal.admin', async () => {
    const { experienceRepo, save } = setup()

    await expect(
      save(
        { propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.getPropertyExperience).not.toHaveBeenCalled()
  })
})
