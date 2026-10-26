import { describe, expect, it } from 'vitest'
import type { PortalLookOverride } from '../domain/portal-look'
import {
  portalLookMediaProfileOf,
  portalLookSavedOf,
  portalLookViewOf,
} from './portal-look-view'
import { NO_PROPERTY_LOOK_MEDIA } from './property-look-media'

const OWN_HERO = '30000000-0000-4000-8000-000000000003'
const OWN_LOGO = '30000000-0000-4000-8000-000000000004'

const following: PortalLookOverride = {
  photo: { mode: 'inherit' },
  colours: { mode: 'inherit' },
  identity: { mode: 'inherit' },
  lookVersion: 5,
}

const ownEverything: PortalLookOverride = {
  photo: {
    mode: 'own',
    heroAssetId: OWN_HERO,
    focalX: 0.5,
    focalY: 0.25,
    altTexts: { en: 'Treatment room' },
  },
  colours: {
    mode: 'own',
    accent: '#2F855A',
    backgroundMode: 'manual',
    backgroundColour: '#0B1F14',
  },
  identity: { mode: 'own', wordmark: 'SPA', logoAssetId: OWN_LOGO },
  lookVersion: 9,
}

const hero = {
  assetId: OWN_HERO,
  url: `/media/portal/${OWN_HERO}`,
  width: 1600,
  height: 900,
  focalX: 0.5,
  focalY: 0.25,
}
const logo = {
  assetId: OWN_LOGO,
  url: `/media/portal/${OWN_LOGO}`,
  width: 480,
  height: 120,
}

describe('portalLookMediaProfileOf', () => {
  it('names only the images of the groups the portal owns', () => {
    expect(portalLookMediaProfileOf(following)).toEqual({
      heroAssetId: null,
      heroFocalX: null,
      heroFocalY: null,
      logoAssetId: null,
    })
    expect(portalLookMediaProfileOf(ownEverything)).toEqual({
      heroAssetId: OWN_HERO,
      heroFocalX: 0.5,
      heroFocalY: 0.25,
      logoAssetId: OWN_LOGO,
    })
  })
})

describe('portalLookViewOf', () => {
  it('carries nothing of its own for a group that follows the property', () => {
    expect(portalLookViewOf(following, NO_PROPERTY_LOOK_MEDIA)).toEqual({
      sources: { photo: 'property', colours: 'property', identity: 'property' },
      lookVersion: 5,
      photo: { mode: 'inherit' },
      colours: { mode: 'inherit' },
      identity: { mode: 'inherit' },
    })
  })

  it('shows each owned group with the images a page would draw', () => {
    expect(portalLookViewOf(ownEverything, { hero, logo })).toEqual({
      sources: { photo: 'portal', colours: 'portal', identity: 'portal' },
      lookVersion: 9,
      photo: { ...ownEverything.photo, hero },
      colours: {
        mode: 'own',
        accentColour: '#2F855A',
        backgroundMode: 'manual',
        backgroundColour: '#0B1F14',
      },
      identity: { mode: 'own', wordmark: 'SPA', logoAssetId: OWN_LOGO, logo },
    })
  })

  it('shows a taken-down own photo as no photo the page can draw, keeping its ids', () => {
    const view = portalLookViewOf(ownEverything, NO_PROPERTY_LOOK_MEDIA)
    expect(view.photo).toMatchObject({ mode: 'own', heroAssetId: OWN_HERO, hero: null })
    expect(view.identity).toMatchObject({ mode: 'own', logo: null })
  })

  it('says when a portal shows no photo', () => {
    expect(
      portalLookViewOf({ ...following, photo: { mode: 'none' } }, NO_PROPERTY_LOOK_MEDIA),
    ).toMatchObject({ sources: { photo: 'none' }, photo: { mode: 'none' } })
  })
})

describe('portalLookSavedOf', () => {
  it('says where the groups come from and whether guests would see a change', () => {
    expect(portalLookSavedOf('portal-1', ownEverything, ['accent'])).toEqual({
      portalId: 'portal-1',
      sources: { photo: 'portal', colours: 'portal', identity: 'portal' },
      lookVersion: 9,
      changed: true,
    })
    expect(portalLookSavedOf('portal-1', following, [])).toMatchObject({ changed: false })
  })
})
