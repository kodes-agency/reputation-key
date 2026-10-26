import { describe, expect, it } from 'vitest'
import {
  PORTAL_LOOK_GROUP_MODE_SQL_LIST,
  PORTAL_LOOK_PHOTO_MODE_SQL_LIST,
} from '#/shared/db/schema/portal-look.schema'
import {
  PORTAL_LOOK_FACETS,
  PORTAL_LOOK_GROUP_MODES,
  PORTAL_LOOK_PHOTO_MODES,
  PROPERTY_LOOK_SOURCES,
  applyPortalLook,
  facetReachesPortal,
  lookGroupsOfFacet,
  lookGroupsOfFacets,
  lookSourcesOf,
  nextPortalLook,
  portalHeroAltTextsOf,
  portalLookColumnsOf,
  portalLookOverrideOf,
  portalLookSourceVersion,
  withPortalHeroAlt,
  type PortalLookBase,
  type PortalLookOverride,
  type PortalLookOverrideRow,
  type PortalLookProfile,
} from './portal-look'

const PROPERTY_HERO = '30000000-0000-4000-8000-000000000001'
const PROPERTY_LOGO = '30000000-0000-4000-8000-000000000002'
const OWN_HERO = '30000000-0000-4000-8000-000000000003'
const OWN_LOGO = '30000000-0000-4000-8000-000000000004'

type Profile = PortalLookProfile & Readonly<{ displayName: string; textColor: string }>

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  displayName: 'Avela Resort',
  textColor: '#111827',
  primaryColor: '#B8860B',
  backgroundColor: '#1A1A1A',
  backgroundMode: 'auto',
  wordmark: 'AVELA',
  logoAssetId: PROPERTY_LOGO,
  heroAssetId: PROPERTY_HERO,
  heroFocalX: 0.3,
  heroFocalY: 0.7,
  lookVersion: 4,
  ...overrides,
})

const base = (
  overrides: Partial<Profile> = {},
  heroAltTexts: PortalLookBase['heroAltTexts'] = { en: 'The pool at dusk' },
): PortalLookBase => ({ profile: profile(overrides), heroAltTexts })

const following: PortalLookOverride = {
  photo: { mode: 'inherit' },
  colours: { mode: 'inherit' },
  identity: { mode: 'inherit' },
  lookVersion: 5,
}

const ownPhoto = {
  mode: 'own',
  heroAssetId: OWN_HERO,
  focalX: 0.5,
  focalY: 0.25,
  altTexts: { en: 'Treatment room with candles' },
} as const satisfies PortalLookOverride['photo']

const ownEverything: PortalLookOverride = {
  photo: ownPhoto,
  colours: {
    mode: 'own',
    accent: '#2F855A',
    backgroundMode: 'manual',
    backgroundColour: '#0B1F14',
  },
  identity: { mode: 'own', wordmark: 'SPA', logoAssetId: OWN_LOGO },
  lookVersion: 9,
}

const row = (overrides: Partial<PortalLookOverrideRow> = {}): PortalLookOverrideRow => ({
  photoMode: 'inherit',
  heroAssetId: null,
  heroFocalX: null,
  heroFocalY: null,
  heroAltTexts: {},
  coloursMode: 'inherit',
  primaryColor: null,
  backgroundMode: null,
  backgroundColor: null,
  identityMode: 'inherit',
  wordmark: null,
  logoAssetId: null,
  lookVersion: 5,
  ...overrides,
})

const valuesOf = (sqlList: string): string[] =>
  sqlList.split(', ').map((quoted) => quoted.replaceAll("'", ''))

describe('the modes', () => {
  it('are exactly what the table CHECKs allow', () => {
    expect([...PORTAL_LOOK_PHOTO_MODES]).toEqual(
      valuesOf(PORTAL_LOOK_PHOTO_MODE_SQL_LIST),
    )
    expect([...PORTAL_LOOK_GROUP_MODES]).toEqual(
      valuesOf(PORTAL_LOOK_GROUP_MODE_SQL_LIST),
    )
  })
})

describe('portalLookOverrideOf and portalLookColumnsOf', () => {
  it('reads a row that follows everything', () => {
    expect(portalLookOverrideOf(row())).toEqual(following)
  })

  it('round-trips an override that owns every group', () => {
    const columns = portalLookColumnsOf(ownEverything)
    expect(columns).toEqual({
      photoMode: 'own',
      heroAssetId: OWN_HERO,
      heroFocalX: 0.5,
      heroFocalY: 0.25,
      heroAltTexts: { en: 'Treatment room with candles' },
      coloursMode: 'own',
      primaryColor: '#2F855A',
      backgroundMode: 'manual',
      backgroundColor: '#0B1F14',
      identityMode: 'own',
      wordmark: 'SPA',
      logoAssetId: OWN_LOGO,
      lookVersion: 9,
    })
    expect(portalLookOverrideOf(columns)).toEqual(ownEverything)
  })

  it('stores no values for a group that follows the Property, and none for no photo', () => {
    expect(portalLookColumnsOf({ ...following, photo: { mode: 'none' } })).toMatchObject({
      photoMode: 'none',
      heroAssetId: null,
      heroFocalX: null,
      heroFocalY: null,
      heroAltTexts: {},
      primaryColor: null,
      backgroundMode: null,
      backgroundColor: null,
      wordmark: null,
      logoAssetId: null,
    })
  })

  it('reads an own identity with neither a wordmark nor a logo as the display name', () => {
    expect(portalLookOverrideOf(row({ identityMode: 'own' })).identity).toEqual({
      mode: 'own',
      wordmark: null,
      logoAssetId: null,
    })
  })

  it('reads an unknown mode, or an owned group missing its values, as following', () => {
    expect(portalLookOverrideOf(row({ photoMode: 'video' })).photo).toEqual({
      mode: 'inherit',
    })
    expect(portalLookOverrideOf(row({ photoMode: 'own' })).photo).toEqual({
      mode: 'inherit',
    })
    expect(
      portalLookOverrideOf(
        row({
          coloursMode: 'own',
          primaryColor: '#2F855A',
          backgroundMode: 'gradient',
          backgroundColor: '#0B1F14',
        }),
      ).colours,
    ).toEqual({ mode: 'inherit' })
    expect(portalLookOverrideOf(row({ identityMode: 'mine' })).identity).toEqual({
      mode: 'inherit',
    })
  })

  it('drops a description in a language the catalogue lacks, and a blank one', () => {
    expect(
      portalHeroAltTextsOf({ en: 'Pool', xx: 'Nope', bg: '   ', de: 42, fr: 'Piscine' }),
    ).toEqual({ en: 'Pool', fr: 'Piscine' })
    expect(portalHeroAltTextsOf(null)).toEqual({})
    expect(portalHeroAltTextsOf(['en'])).toEqual({})
    expect(portalHeroAltTextsOf('en')).toEqual({})
  })
})

describe('lookSourcesOf', () => {
  it('says every group is the Property’s without an override', () => {
    expect(lookSourcesOf(null)).toBe(PROPERTY_LOOK_SOURCES)
    expect(lookSourcesOf(following)).toEqual(PROPERTY_LOOK_SOURCES)
  })

  it('names each owned group, and a Portal with no photo', () => {
    expect(lookSourcesOf(ownEverything)).toEqual({
      photo: 'portal',
      colours: 'portal',
      identity: 'portal',
    })
    expect(lookSourcesOf({ ...following, photo: { mode: 'none' } })).toEqual({
      photo: 'none',
      colours: 'property',
      identity: 'property',
    })
  })
})

describe('facets and groups', () => {
  it('maps each facet to its group, and the older images facet to two', () => {
    expect(lookGroupsOfFacet('accent')).toEqual(['colours'])
    expect(lookGroupsOfFacet('field')).toEqual(['colours'])
    expect(lookGroupsOfFacet('text')).toEqual(['colours'])
    expect(lookGroupsOfFacet('wordmark')).toEqual(['identity'])
    expect(lookGroupsOfFacet('logo')).toEqual(['identity'])
    expect(lookGroupsOfFacet('photo')).toEqual(['photo'])
    expect(lookGroupsOfFacet('images')).toEqual(['photo', 'identity'])
  })

  it('lists the groups of several facets once each, in group order', () => {
    expect(lookGroupsOfFacets(['wordmark', 'accent', 'field', 'logo'])).toEqual([
      'colours',
      'identity',
    ])
    expect(lookGroupsOfFacets(['images'])).toEqual(['photo', 'identity'])
    expect(lookGroupsOfFacets([])).toEqual([])
  })

  it('lets a Property change reach only a Portal that follows its group', () => {
    const ownColours = lookSourcesOf({ ...following, colours: ownEverything.colours })
    expect(facetReachesPortal('accent', ownColours)).toBe(false)
    expect(facetReachesPortal('field', ownColours)).toBe(false)
    expect(facetReachesPortal('photo', ownColours)).toBe(true)
    expect(facetReachesPortal('logo', ownColours)).toBe(true)
    expect(facetReachesPortal('accent', PROPERTY_LOOK_SOURCES)).toBe(true)
  })

  it('keeps the Property photo from a Portal that shows no photo', () => {
    const noPhoto = lookSourcesOf({ ...following, photo: { mode: 'none' } })
    expect(facetReachesPortal('photo', noPhoto)).toBe(false)
  })

  it('lets a legacy images row reach a Portal unless it owns both the photo and the logo', () => {
    const photoOwner = lookSourcesOf({ ...following, photo: ownPhoto })
    const identityOwner = lookSourcesOf({
      ...following,
      identity: ownEverything.identity,
    })
    const ownBoth = lookSourcesOf({
      ...following,
      photo: ownEverything.photo,
      identity: ownEverything.identity,
    })
    expect(facetReachesPortal('images', PROPERTY_LOOK_SOURCES)).toBe(true)
    expect(facetReachesPortal('images', photoOwner)).toBe(true)
    expect(facetReachesPortal('images', identityOwner)).toBe(true)
    expect(facetReachesPortal('images', ownBoth)).toBe(false)
  })

  it('lists the facets a Portal can own in a fixed order, without the text colour', () => {
    expect([...PORTAL_LOOK_FACETS]).toEqual([
      'accent',
      'field',
      'wordmark',
      'logo',
      'photo',
    ])
  })
})

describe('applyPortalLook', () => {
  it('is the profile itself with no override', () => {
    const property = profile()
    expect(applyPortalLook(property, null)).toBe(property)
  })

  it('keeps every Property value of a group that follows, and takes the Portal’s version', () => {
    expect(applyPortalLook(profile(), following)).toEqual({
      ...profile(),
      lookVersion: 5,
    })
  })

  it('lays every owned group over the profile and leaves what is not the look alone', () => {
    const property = profile()
    expect(applyPortalLook(property, ownEverything)).toEqual({
      ...property,
      primaryColor: '#2F855A',
      backgroundMode: 'manual',
      backgroundColor: '#0B1F14',
      wordmark: 'SPA',
      logoAssetId: OWN_LOGO,
      heroAssetId: OWN_HERO,
      heroFocalX: 0.5,
      heroFocalY: 0.25,
      lookVersion: 9,
    })
    expect(property).toEqual(profile())
  })

  it('takes the photo off for a Portal with no photo, and keeps the rest', () => {
    expect(applyPortalLook(profile(), { ...following, photo: { mode: 'none' } })).toEqual(
      {
        ...profile(),
        heroAssetId: null,
        heroFocalX: null,
        heroFocalY: null,
        lookVersion: 5,
      },
    )
  })

  it('shows the display name for an own identity with neither wordmark nor logo', () => {
    const applied = applyPortalLook(profile(), {
      ...following,
      identity: { mode: 'own', wordmark: null, logoAssetId: null },
    })
    expect(applied.wordmark).toBeNull()
    expect(applied.logoAssetId).toBeNull()
    expect(applied.displayName).toBe('Avela Resort')
  })

  it('applies each group on its own', () => {
    const applied = applyPortalLook(profile(), { ...following, photo: ownPhoto })
    expect(applied.heroAssetId).toBe(OWN_HERO)
    expect(applied.primaryColor).toBe('#B8860B')
    expect(applied.logoAssetId).toBe(PROPERTY_LOGO)
  })
})

describe('withPortalHeroAlt', () => {
  const contents = [
    {
      locale: 'en',
      title: 'Welcome',
      shortDescription: 'Hello',
      heroAltText: 'The pool at dusk',
    },
    {
      locale: 'bg',
      title: 'Добре дошли',
      shortDescription: 'Здравейте',
      heroAltText: null,
    },
  ] as const

  it('returns the rows as they are with no override, or when the photo follows', () => {
    expect(withPortalHeroAlt(contents, null)).toBe(contents)
    expect(withPortalHeroAlt(contents, following)).toBe(contents)
  })

  it('describes no photo for a Portal that shows none', () => {
    expect(
      withPortalHeroAlt(contents, { ...following, photo: { mode: 'none' } }),
    ).toEqual([{ ...contents[0], heroAltText: null }, contents[1]])
  })

  it('never uses the Property’s description of another photo for an own photo', () => {
    const own = withPortalHeroAlt(contents, {
      ...following,
      photo: { ...ownPhoto, altTexts: { bg: 'Стая за масаж' } },
    })
    expect(own).toEqual([
      { ...contents[0], heroAltText: null },
      { ...contents[1], heroAltText: 'Стая за масаж' },
    ])
  })

  it('adds a description-only row for a language the Property wrote nothing in', () => {
    const own = withPortalHeroAlt(contents, {
      ...following,
      photo: {
        ...ownPhoto,
        altTexts: { en: 'Treatment room', de: 'Behandlungsraum' },
      },
    })
    expect(own).toEqual([
      { ...contents[0], heroAltText: 'Treatment room' },
      { ...contents[1], heroAltText: null },
      { locale: 'de', title: '', shortDescription: '', heroAltText: 'Behandlungsraum' },
    ])
  })

  it('leaves the given rows unchanged', () => {
    withPortalHeroAlt(contents, ownEverything)
    expect(contents[0].heroAltText).toBe('The pool at dusk')
  })
})

describe('nextPortalLook', () => {
  describe('colours', () => {
    it('copies the Property’s colours on a first own save, so nothing moves and no version is spent', () => {
      const next = nextPortalLook(null, base(), { group: 'colours', mode: 'own' })
      expect(next.changedFacets).toEqual([])
      expect(next.override).toEqual({
        ...following,
        colours: {
          mode: 'own',
          accent: '#B8860B',
          backgroundMode: 'auto',
          backgroundColour: '#1A1A1A',
        },
        lookVersion: 4,
      })
    })

    it('starts a first row one above the Property’s version when the look moves', () => {
      const next = nextPortalLook(null, base(), {
        group: 'colours',
        mode: 'own',
        accent: '#2F855A',
      })
      expect(next.changedFacets).toEqual(['accent'])
      expect(next.override.lookVersion).toBe(5)
    })

    it('moves one above its own version on a later change, and not at all on a repeat', () => {
      const current: PortalLookOverride = { ...following, colours: ownEverything.colours }
      const moved = nextPortalLook(current, base(), {
        group: 'colours',
        mode: 'own',
        backgroundMode: 'auto',
      })
      expect(moved.changedFacets).toEqual(['field'])
      expect(moved.override.lookVersion).toBe(6)
      const repeated = nextPortalLook(moved.override, base(), {
        group: 'colours',
        mode: 'own',
        backgroundMode: 'auto',
      })
      expect(repeated.changedFacets).toEqual([])
      expect(repeated.override.lookVersion).toBe(6)
    })

    it('keeps the values a save leaves out', () => {
      const current: PortalLookOverride = { ...following, colours: ownEverything.colours }
      const next = nextPortalLook(current, base(), {
        group: 'colours',
        mode: 'own',
        accent: '#276749',
      })
      expect(next.override.colours).toEqual({
        ...ownEverything.colours,
        accent: '#276749',
      })
      expect(next.changedFacets).toEqual(['accent'])
    })

    it('goes back to the Property’s colours and names what guests see move', () => {
      const current: PortalLookOverride = { ...following, colours: ownEverything.colours }
      const next = nextPortalLook(current, base(), { group: 'colours', mode: 'inherit' })
      expect(next.override.colours).toEqual({ mode: 'inherit' })
      expect(next.changedFacets).toEqual(['accent', 'field'])
      expect(next.override.lookVersion).toBe(6)
    })

    it('refuses an own pair whose page text could not be read', () => {
      expect(() =>
        nextPortalLook(null, base(), {
          group: 'colours',
          mode: 'own',
          backgroundMode: 'manual',
          backgroundColour: '#F5F5F5',
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_theme' }))
      expect(() =>
        nextPortalLook(null, base(), { group: 'colours', mode: 'own', accent: 'gold' }),
      ).toThrow(expect.objectContaining({ code: 'invalid_theme' }))
    })
  })

  describe('name and logo', () => {
    it('copies the Property’s wordmark and logo on a first own save', () => {
      const next = nextPortalLook(null, base(), { group: 'identity', mode: 'own' })
      expect(next.override.identity).toEqual({
        mode: 'own',
        wordmark: 'AVELA',
        logoAssetId: PROPERTY_LOGO,
      })
      expect(next.changedFacets).toEqual([])
      expect(next.override.lookVersion).toBe(4)
    })

    it('trims the wordmark, clears an empty one and names the logo apart', () => {
      const next = nextPortalLook(null, base(), {
        group: 'identity',
        mode: 'own',
        wordmark: '   ',
        logoAssetId: OWN_LOGO,
      })
      expect(next.override.identity).toEqual({
        mode: 'own',
        wordmark: null,
        logoAssetId: OWN_LOGO,
      })
      expect(next.changedFacets).toEqual(['wordmark', 'logo'])
    })

    it('refuses a wordmark over 24 characters', () => {
      expect(() =>
        nextPortalLook(null, base(), {
          group: 'identity',
          mode: 'own',
          wordmark: 'A'.repeat(25),
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_description' }))
    })
  })

  describe('photo', () => {
    it('copies the Property’s photo, anchor and descriptions when owned without a new one', () => {
      const next = nextPortalLook(null, base(), { group: 'photo', mode: 'own' })
      expect(next.override.photo).toEqual({
        mode: 'own',
        heroAssetId: PROPERTY_HERO,
        focalX: 0.3,
        focalY: 0.7,
        altTexts: { en: 'The pool at dusk' },
      })
      expect(next.changedFacets).toEqual([])
    })

    it('centres a new photo and starts it with no descriptions', () => {
      const next = nextPortalLook(null, base(), {
        group: 'photo',
        mode: 'own',
        heroAssetId: OWN_HERO,
      })
      expect(next.override.photo).toEqual({
        mode: 'own',
        heroAssetId: OWN_HERO,
        focalX: 0.5,
        focalY: 0.5,
        altTexts: {},
      })
      expect(next.changedFacets).toEqual(['photo'])
      expect(next.override.lookVersion).toBe(5)
    })

    it('moves the anchor alone, keeping the photo and its descriptions', () => {
      const current: PortalLookOverride = { ...following, photo: ownEverything.photo }
      const next = nextPortalLook(current, base(), {
        group: 'photo',
        mode: 'own',
        focalY: 0.6,
      })
      expect(next.override.photo).toEqual({
        ...ownEverything.photo,
        focalX: 0.5,
        focalY: 0.6,
      })
      expect(next.changedFacets).toEqual(['photo'])
    })

    it('sets and clears descriptions per language and counts them as the photo', () => {
      const current: PortalLookOverride = { ...following, photo: ownEverything.photo }
      const next = nextPortalLook(current, base(), {
        group: 'photo',
        mode: 'own',
        altTexts: { en: null, bg: '  Стая  ' },
      })
      expect(next.override.photo).toMatchObject({ altTexts: { bg: 'Стая' } })
      expect(next.changedFacets).toEqual(['photo'])
    })

    it('refuses a description over 160 characters and an anchor outside the photo', () => {
      expect(() =>
        nextPortalLook(null, base(), {
          group: 'photo',
          mode: 'own',
          heroAssetId: OWN_HERO,
          altTexts: { en: 'x'.repeat(161) },
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_description' }))
      expect(() =>
        nextPortalLook(null, base(), {
          group: 'photo',
          mode: 'own',
          heroAssetId: OWN_HERO,
          focalX: 1.2,
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_theme' }))
    })

    it('refuses an own photo when there is none to keep or copy', () => {
      expect(() =>
        nextPortalLook(
          null,
          base({ heroAssetId: null, heroFocalX: null, heroFocalY: null }),
          {
            group: 'photo',
            mode: 'own',
          },
        ),
      ).toThrow(expect.objectContaining({ code: 'invalid_theme' }))
    })

    it('takes the photo off for no photo, and names the photo', () => {
      const next = nextPortalLook(null, base(), { group: 'photo', mode: 'none' })
      expect(next.override.photo).toEqual({ mode: 'none' })
      expect(next.changedFacets).toEqual(['photo'])
    })

    it('moves nothing for no photo on a Property that has none to show', () => {
      const next = nextPortalLook(
        null,
        base({ heroAssetId: null, heroFocalX: null, heroFocalY: null }),
        { group: 'photo', mode: 'none' },
      )
      expect(next.changedFacets).toEqual([])
      expect(next.override.lookVersion).toBe(4)
    })

    it('goes back to the Property’s photo and its descriptions', () => {
      const current: PortalLookOverride = { ...following, photo: ownEverything.photo }
      const next = nextPortalLook(current, base(), { group: 'photo', mode: 'inherit' })
      expect(next.override.photo).toEqual({ mode: 'inherit' })
      expect(next.changedFacets).toEqual(['photo'])
      expect(next.override.lookVersion).toBe(6)
    })
  })

  it('changes one group and leaves the others as they were', () => {
    const next = nextPortalLook(ownEverything, base(), {
      group: 'colours',
      mode: 'inherit',
    })
    expect(next.override.photo).toBe(ownEverything.photo)
    expect(next.override.identity).toBe(ownEverything.identity)
    expect(next.override.lookVersion).toBe(10)
  })
})

describe('portalLookSourceVersion', () => {
  it('names the version the edit was written at', () => {
    expect(portalLookSourceVersion(7)).toBe('look:v7')
  })
})
