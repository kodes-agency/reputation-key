import { describe, expect, it } from 'vitest'
import type {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import {
  contentFromRow,
  overrideFromRow,
  profileFromRow,
} from './portal-experience.mapper'

const now = new Date('2026-09-30T10:00:00Z')

const contentRow: typeof propertyPortalBrandContents.$inferSelect = {
  id: 'content-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  locale: 'bg',
  title: 'Заглавие',
  shortDescription: 'Описание',
  heroAltText: null,
  version: 1,
  updatedBy: 'user-1',
  createdAt: now,
  updatedAt: now,
}

const profileRow: typeof propertyPortalBrandProfiles.$inferSelect = {
  id: 'profile-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  displayName: 'Harbour House',
  logoUrl: null,
  defaultHeroImageUrl: null,
  logoAssetId: null,
  heroAssetId: null,
  heroFocalX: null,
  heroFocalY: null,
  primaryColor: '#C8A45A',
  backgroundColor: '#14110F',
  textColor: '#F5F1E8',
  wordmark: 'HARBOUR',
  backgroundMode: 'manual',
  defaultGuestLocales: ['bg', 'en'],
  lookVersion: 4,
  version: 2,
  updatedBy: 'user-1',
  createdAt: now,
  updatedAt: now,
}

const overrideRow: typeof portalLocalizedOverrides.$inferSelect = {
  id: 'override-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  portalId: 'portal-1',
  locale: 'en',
  title: 'Title',
  shortDescription: 'Description',
  heroImageUrl: null,
  linktreeTitle: 'Around town',
  version: 1,
  updatedBy: 'user-1',
  createdAt: now,
  updatedAt: now,
}

describe('portal experience row mappers', () => {
  it('reads the locale a row stores', () => {
    expect(contentFromRow(contentRow).locale).toBe('bg')
    expect(overrideFromRow(overrideRow).locale).toBe('en')
    expect(contentFromRow({ ...contentRow, locale: 'de' }).locale).toBe('de')
  })

  it('carries the Linktree title, null when the manager has not written one', () => {
    expect(overrideFromRow(overrideRow).linktreeTitle).toBe('Around town')
    expect(
      overrideFromRow({ ...overrideRow, linktreeTitle: null }).linktreeTitle,
    ).toBeNull()
  })

  it('throws on a locale outside the catalogue and never returns en for it', () => {
    expect(() => contentFromRow({ ...contentRow, locale: 'pt' })).toThrow(/locale/)
    expect(() => overrideFromRow({ ...overrideRow, locale: '' })).toThrow(/locale/)
  })

  it('carries the hero alt text, null until one is written', () => {
    expect(contentFromRow(contentRow).heroAltText).toBeNull()
    expect(
      contentFromRow({ ...contentRow, heroAltText: 'The harbour' }).heroAltText,
    ).toBe('The harbour')
  })

  describe('profileFromRow', () => {
    it('carries the look fields and both versions', () => {
      expect(profileFromRow(profileRow)).toMatchObject({
        wordmark: 'HARBOUR',
        backgroundMode: 'manual',
        defaultGuestLocales: ['bg', 'en'],
        lookVersion: 4,
        version: 2,
      })
    })

    it('keeps the default languages in their stored order', () => {
      expect(
        profileFromRow({ ...profileRow, defaultGuestLocales: ['de', 'bg', 'en'] })
          .defaultGuestLocales,
      ).toEqual(['de', 'bg', 'en'])
    })

    it('throws on a background mode outside the closed set', () => {
      expect(() => profileFromRow({ ...profileRow, backgroundMode: 'dark' })).toThrow(
        /background mode/,
      )
    })

    it('throws on default languages that are empty, not a list or outside the catalogue', () => {
      expect(() => profileFromRow({ ...profileRow, defaultGuestLocales: [] })).toThrow(
        /default guest languages/,
      )
      expect(() => profileFromRow({ ...profileRow, defaultGuestLocales: 'en' })).toThrow(
        /default guest languages/,
      )
      expect(() =>
        profileFromRow({ ...profileRow, defaultGuestLocales: ['en', 'pt'] }),
      ).toThrow(/locale/)
    })
  })
})
