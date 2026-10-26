// Story data for a portal's own look: "Pool & Terrace" at Avela Resort, in
// the editor's resources. The three writes answer like the server does: they
// apply the input to the look the story holds and say where each group now comes
// from, so a play can press "Set colours for this portal", edit the accent and
// watch the section change, as it does once the read is refreshed.

import { fn } from 'storybook/test'
import {
  PROPERTY_LOOK_SOURCES,
  type PortalLookColoursInput,
  type PortalLookIdentityInput,
  type PortalLookPhotoInput,
  type PortalLookSaved,
  type PortalLookSources,
  type PortalLookView,
  type PropertyLookMedia,
} from '#/contexts/portal/application/public-api'
import type { PortalEditorResources } from '../../portal-editor/portal-editor-types'
import {
  action,
  makeResources,
} from '../../portal-editor/__fixtures__/portal-editor-fixtures'
import { PREVIEW_STORY_PHOTO } from '../../portal-preview/__fixtures__/portal-preview-fixtures'
import type { PortalLookActions } from '../portal-look-types'

export const PORTAL_ID = 'p-1'
export const PROPERTY_ID = 'prop-1'

export const OWN_PHOTO_ASSET = '30000000-0000-4000-8000-0000000000c1'
export const OWN_LOGO_ASSET = '30000000-0000-4000-8000-0000000000c2'

/** The property's profile as the settings read gives it. */
export const AVELA_LOOK_PROFILE = {
  displayName: 'Avela Resort',
  primaryColor: '#EAD6A8',
  backgroundColor: '#14110F',
  textColor: '#111827',
  backgroundMode: 'auto',
  wordmark: 'AVELA',
} as const

const photo = (assetId: string, focalX: number, focalY: number) => ({
  assetId,
  url: PREVIEW_STORY_PHOTO,
  width: 1600,
  height: 1000,
  focalX,
  focalY,
})

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120"><text x="240" y="82" text-anchor="middle" font-family="Georgia, serif" font-size="64" letter-spacing="14" fill="#9AD6C8">POOL</text></svg>`
const logo = (assetId: string) => ({
  assetId,
  url: `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`,
  width: 480,
  height: 120,
})

/** The property's photograph; its logo is none. */
export const PROPERTY_MEDIA: PropertyLookMedia = {
  hero: photo('30000000-0000-4000-8000-0000000000a1', 0.5, 0.42),
  logo: null,
}

const INHERIT = { mode: 'inherit' } as const

/** A portal that follows the property in every group. */
export const FOLLOWS_EVERYTHING: PortalLookView = {
  sources: PROPERTY_LOOK_SOURCES,
  lookVersion: 4,
  photo: INHERIT,
  colours: INHERIT,
  identity: INHERIT,
}

const sourcesOf = (view: Omit<PortalLookView, 'sources'>): PortalLookSources => ({
  photo:
    view.photo.mode === 'own'
      ? 'portal'
      : view.photo.mode === 'none'
        ? 'none'
        : 'property',
  colours: view.colours.mode === 'own' ? 'portal' : 'property',
  identity: view.identity.mode === 'own' ? 'portal' : 'property',
})

function withSources(view: Omit<PortalLookView, 'sources'>): PortalLookView {
  return { ...view, sources: sourcesOf(view) }
}

export const OWN_PHOTO: PortalLookView = withSources({
  lookVersion: 5,
  photo: {
    mode: 'own',
    heroAssetId: OWN_PHOTO_ASSET,
    focalX: 0.3,
    focalY: 0.6,
    altTexts: { en: 'The thermal pool, lit at dusk' },
    hero: photo(OWN_PHOTO_ASSET, 0.3, 0.6),
  },
  colours: INHERIT,
  identity: INHERIT,
})

const OWN_COLOURS_VALUE = {
  mode: 'own',
  accentColour: '#9AD6C8',
  backgroundMode: 'auto',
  backgroundColour: '#14110F',
} as const

export const OWN_COLOURS: PortalLookView = withSources({
  lookVersion: 5,
  photo: INHERIT,
  colours: OWN_COLOURS_VALUE,
  identity: INHERIT,
})

export const OWN_IDENTITY: PortalLookView = withSources({
  lookVersion: 5,
  photo: INHERIT,
  colours: INHERIT,
  identity: {
    mode: 'own',
    wordmark: 'POOL',
    logoAssetId: OWN_LOGO_ASSET,
    logo: logo(OWN_LOGO_ASSET),
  },
})

export const OWN_EVERYTHING: PortalLookView = withSources({
  lookVersion: 7,
  photo: OWN_PHOTO.photo,
  colours: OWN_COLOURS_VALUE,
  identity: { mode: 'own', wordmark: 'POOL', logoAssetId: null, logo: null },
})

export const NO_PHOTO: PortalLookView = withSources({
  lookVersion: 5,
  photo: { mode: 'none' },
  colours: INHERIT,
  identity: INHERIT,
})

/** The portal's own photo was taken down: it resolves to no photo, and the editor says so. */
export const TAKEN_DOWN_PHOTO: PortalLookView = withSources({
  lookVersion: 5,
  photo: {
    mode: 'own',
    heroAssetId: OWN_PHOTO_ASSET,
    focalX: 0.3,
    focalY: 0.6,
    altTexts: { en: 'The thermal pool, lit at dusk' },
    hero: null,
  },
  colours: INHERIT,
  identity: INHERIT,
})

// ── The server's side of the three writes ────────────────────────────────────

function applyColours(
  view: PortalLookView,
  input: PortalLookColoursInput['colours'],
): PortalLookView['colours'] {
  if (input.mode === 'inherit') return INHERIT
  const current = view.colours.mode === 'own' ? view.colours : null
  return {
    mode: 'own',
    accentColour:
      input.accentColour ?? current?.accentColour ?? AVELA_LOOK_PROFILE.primaryColor,
    backgroundMode:
      input.backgroundMode ??
      current?.backgroundMode ??
      AVELA_LOOK_PROFILE.backgroundMode,
    backgroundColour:
      input.backgroundColour ??
      current?.backgroundColour ??
      AVELA_LOOK_PROFILE.backgroundColor,
  }
}

function applyIdentity(
  view: PortalLookView,
  input: PortalLookIdentityInput['identity'],
): PortalLookView['identity'] {
  if (input.mode === 'inherit') return INHERIT
  const current = view.identity.mode === 'own' ? view.identity : null
  const wordmark =
    input.wordmark === undefined
      ? (current?.wordmark ?? AVELA_LOOK_PROFILE.wordmark)
      : input.wordmark
  const logoAssetId =
    input.logoAssetId === undefined ? (current?.logoAssetId ?? null) : input.logoAssetId
  return {
    mode: 'own',
    wordmark,
    logoAssetId,
    logo: logoAssetId === null ? null : logo(logoAssetId),
  }
}

function applyPhoto(
  view: PortalLookView,
  input: PortalLookPhotoInput['photo'],
): PortalLookView['photo'] {
  if (input.mode !== 'own') return input
  const current = view.photo.mode === 'own' ? view.photo : null
  const heroAssetId = input.heroAssetId ?? current?.heroAssetId ?? OWN_PHOTO_ASSET
  const focalX = input.focalX ?? current?.focalX ?? 0.5
  const focalY = input.focalY ?? current?.focalY ?? 0.5
  const written = Object.fromEntries(
    (input.altTexts ?? []).flatMap(({ locale, text }) =>
      text === null ? [] : [[locale, text]],
    ),
  )
  return {
    mode: 'own',
    heroAssetId,
    focalX,
    focalY,
    altTexts: input.altTexts ? written : (current?.altTexts ?? {}),
    hero: photo(heroAssetId, focalX, focalY),
  }
}

/** What the server answers once the input is applied to `view`. */
export function afterColours(view: PortalLookView, input: PortalLookColoursInput) {
  return withSources({
    ...view,
    lookVersion: view.lookVersion + 1,
    colours: applyColours(view, input.colours),
  })
}

export function afterIdentity(view: PortalLookView, input: PortalLookIdentityInput) {
  return withSources({
    ...view,
    lookVersion: view.lookVersion + 1,
    identity: applyIdentity(view, input.identity),
  })
}

export function afterPhoto(view: PortalLookView, input: PortalLookPhotoInput) {
  return withSources({
    ...view,
    lookVersion: view.lookVersion + 1,
    photo: applyPhoto(view, input.photo),
  })
}

const savedOf = (view: PortalLookView): PortalLookSaved => ({
  portalId: PORTAL_ID,
  sources: view.sources,
  lookVersion: view.lookVersion,
  changed: true,
})

/** The look a story holds, which every write replaces and the section reads. */
export type LookStore = ReturnType<typeof createLookStore>

export function createLookStore(initial: PortalLookView | null) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (next: PortalLookView) => {
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The three writes, recording what they were sent and applying it to the store. */
export function storedLookActions(
  store: LookStore,
  onWrite: (input: unknown) => void,
  uploadImage?: PortalLookActions['uploadImage'],
): PortalLookActions {
  const writing =
    <I>(after: (view: PortalLookView, input: I) => PortalLookView) =>
    async ({ data }: { data: I }) => {
      onWrite(data)
      const next = after(store.get() ?? FOLLOWS_EVERYTHING, data)
      store.set(next)
      return savedOf(next)
    }
  return {
    saveColours: action(writing(afterColours)),
    saveIdentity: action(writing(afterIdentity)),
    savePhoto: action(writing(afterPhoto)),
    ...(uploadImage ? { uploadImage } : {}),
  }
}

/** Writes that are never made: the section only has to be read. */
export const idleLookActions = (): PortalLookActions => ({
  saveColours: action(async () => savedOf(FOLLOWS_EVERYTHING)),
  saveIdentity: action(async () => savedOf(FOLLOWS_EVERYTHING)),
  savePhoto: action(async () => savedOf(FOLLOWS_EVERYTHING)),
})

/** A spy for the writes of a story. */
export const writeSpy = () => fn<(input: unknown) => void>()

export type LookResourcesOptions = Readonly<{
  look: PortalLookView | null
  siblingPortalCount?: number
  enabled?: boolean
  /** An Account Admin; a Property Manager is false. */
  canManage?: boolean
  archived?: boolean
  actions: PortalLookActions
}>

/** The editor's resources for the Look section: the Avela fixtures with a portal's own look on them. */
export function lookResources({
  look,
  siblingPortalCount = 3,
  enabled = true,
  canManage = true,
  archived = false,
  actions,
}: LookResourcesOptions): PortalEditorResources {
  const base = makeResources(action(async () => undefined))
  const experience = base.portalExperience
  if (!experience) throw new Error('The editor fixtures carry a settings read')
  return {
    ...base,
    portal: archived
      ? { ...base.portal, publicationState: 'archived' as const }
      : base.portal,
    portalExperience: {
      ...experience,
      profile: AVELA_LOOK_PROFILE,
      media: PROPERTY_MEDIA,
      canManagePropertyBrand: canManage,
      portalLook: look,
      siblingPortalCount,
      portalLookEnabled: enabled,
    },
    portalLookActions: actions,
  }
}
