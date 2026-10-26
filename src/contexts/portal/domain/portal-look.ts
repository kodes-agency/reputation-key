// Portal context — a Portal's own look (ADR 0070). Pure rules.
//
// Every Portal follows its Property's look (the Brand Profile) until an Account
// Admin gives it its own version of one of three groups:
//
//  - photo: the hero, where it is anchored and its description per language;
//    besides following and owning, a Portal can show no photo at all;
//  - colours: the accent and the background together, as contrast is judged on
//    the pair;
//  - identity: the wordmark and the logo.
//
// Each group follows or is owned on its own, so a Portal with its own photo
// still picks up a later change of the Property's colours. The public display
// name, the default languages and the Property's wording are never a Portal's.
//
// The override is resolved where a working copy is read, never when a guest
// opens a page: `applyPortalLook` lays the Portal's own groups over a Brand
// Profile and `withPortalHeroAlt` over the Property's content rows, each
// returning the shape it was given, so every resolver after them (publish, the
// draft preview, the print kit) is unchanged. With no override both return their
// input as it is, which is why a Portal with no row publishes exactly what it
// published before Portals could have a look of their own.
//
// The Portal's effective look version is the override's `lookVersion` when it
// has one, else the Property's. `nextPortalLook` decides the next override from
// what guests would see before and after, so a save that moves nothing visible
// moves no version and records nothing.

import { isGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import type { Permission } from '#/shared/domain/permissions'
import { readLookContrast } from '#/shared/domain/portal-look-readout'
import { portalError } from './errors'
import {
  BACKGROUND_MODES,
  normaliseFocalPoint,
  normaliseHeroAltText,
  normaliseWordmark,
  type BackgroundMode,
  type LookFacet,
} from './property-look'

/**
 * Who may change a Portal's own look: Account Admins, as for the Property's
 * photo and logo (ADR 0063 decision 7). One constant, so letting a Portal's
 * Property Manager edit it later is a local change.
 */
export const PORTAL_LOOK_EDIT_PERMISSION = 'portal.admin' satisfies Permission

const PORTAL_LOOK_GROUPS = Object.freeze(['photo', 'colours', 'identity'] as const)
export type PortalLookGroup = (typeof PORTAL_LOOK_GROUPS)[number]

export const PORTAL_LOOK_PHOTO_MODES = Object.freeze(['inherit', 'own', 'none'] as const)
export type PortalLookPhotoMode = (typeof PORTAL_LOOK_PHOTO_MODES)[number]

/** The modes of the colours and of the name and logo. */
export const PORTAL_LOOK_GROUP_MODES = Object.freeze(['inherit', 'own'] as const)
export type PortalLookGroupMode = (typeof PORTAL_LOOK_GROUP_MODES)[number]

/**
 * The parts of a Portal's own look a change can name, in the order they are
 * listed. The text colour is never a Portal's (no v4 snapshot), so it is not here.
 */
export const PORTAL_LOOK_FACETS = Object.freeze([
  'accent',
  'field',
  'wordmark',
  'logo',
  'photo',
] as const satisfies readonly LookFacet[])
export type PortalLookFacet = (typeof PORTAL_LOOK_FACETS)[number]

/** A photo's description per guest language; a language left out has none. */
export type PortalHeroAltTexts = Readonly<Partial<Record<GuestLocale, string>>>

export type PortalLookPhoto =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{ mode: 'none' }>
  | Readonly<{
      mode: 'own'
      heroAssetId: string
      /** Where pages crop around: 0 to 1 across and down. */
      focalX: number
      focalY: number
      /** The description of this photo; the Property's describes another photo and is never used. */
      altTexts: PortalHeroAltTexts
    }>

export type PortalLookColours =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{
      mode: 'own'
      accent: string
      backgroundMode: BackgroundMode
      /** Kept in automatic mode too: the last custom background, as the Brand Profile keeps it. */
      backgroundColour: string
    }>

export type PortalLookIdentity =
  | Readonly<{ mode: 'inherit' }>
  | Readonly<{
      mode: 'own'
      /** Null shows the public display name. */
      wordmark: string | null
      /** Null shows no logo. */
      logoAssetId: string | null
    }>

/** A Portal's override of the Property look: one mode per group and its version. */
export type PortalLookOverride = Readonly<{
  photo: PortalLookPhoto
  colours: PortalLookColours
  identity: PortalLookIdentity
  /** The Portal's effective look version. */
  lookVersion: number
}>

/** The look columns of a `portal_look_overrides` row, as a reader gets them. */
export type PortalLookOverrideRow = Readonly<{
  photoMode: string
  heroAssetId: string | null
  heroFocalX: number | null
  heroFocalY: number | null
  heroAltTexts: unknown
  coloursMode: string
  primaryColor: string | null
  backgroundMode: string | null
  backgroundColor: string | null
  identityMode: string
  wordmark: string | null
  logoAssetId: string | null
  lookVersion: number
}>

/** The look columns as a writer stores them: each group's values only while it is owned. */
export type PortalLookOverrideColumns = Readonly<{
  photoMode: PortalLookPhotoMode
  heroAssetId: string | null
  heroFocalX: number | null
  heroFocalY: number | null
  heroAltTexts: PortalHeroAltTexts
  coloursMode: PortalLookGroupMode
  primaryColor: string | null
  backgroundMode: BackgroundMode | null
  backgroundColor: string | null
  identityMode: PortalLookGroupMode
  wordmark: string | null
  logoAssetId: string | null
  lookVersion: number
}>

/** Where each group of a Portal's look comes from. */
export type PortalLookSources = Readonly<{
  photo: 'property' | 'portal' | 'none'
  colours: 'property' | 'portal'
  identity: 'property' | 'portal'
}>

/** A Portal with no override: everything follows the Property look. */
export const PROPERTY_LOOK_SOURCES: PortalLookSources = Object.freeze({
  photo: 'property',
  colours: 'property',
  identity: 'property',
})

/** The look-bearing fields of a Brand Profile, as the working-copy reader and the draft preview hold them. */
export type PortalLookProfile = Readonly<{
  primaryColor: string
  backgroundColor: string
  backgroundMode: string
  wordmark: string | null
  logoAssetId: string | null
  heroAssetId: string | null
  heroFocalX: number | null
  heroFocalY: number | null
  lookVersion: number
}>

/** One language's Property content row, as far as the photo's description goes. */
export type PortalHeroAltContent = Readonly<{
  locale: string
  title: string
  shortDescription: string
  heroAltText: string | null
}>

/**
 * A row holding only a description, for a language the Property wrote nothing
 * in: the representation the Property's own photo descriptions already use.
 */
export type PortalHeroAltOnlyContent = Readonly<{
  locale: GuestLocale
  title: ''
  shortDescription: ''
  heroAltText: string
}>

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** The descriptions a stored object holds: a language the catalogue lacks, and a blank text, are left out. */
export function portalHeroAltTextsOf(value: unknown): PortalHeroAltTexts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [GuestLocale, string] =>
        isGuestLocale(entry[0]) && isText(entry[1]),
    ),
  )
}

function photoOfRow(row: PortalLookOverrideRow): PortalLookPhoto {
  if (row.photoMode === 'none') return { mode: 'none' }
  const { heroAssetId, heroFocalX, heroFocalY } = row
  if (
    row.photoMode !== 'own' ||
    heroAssetId === null ||
    heroFocalX === null ||
    heroFocalY === null
  ) {
    return { mode: 'inherit' }
  }
  return {
    mode: 'own',
    heroAssetId,
    focalX: heroFocalX,
    focalY: heroFocalY,
    altTexts: portalHeroAltTextsOf(row.heroAltTexts),
  }
}

function coloursOfRow(row: PortalLookOverrideRow): PortalLookColours {
  const { primaryColor, backgroundMode, backgroundColor } = row
  const mode = BACKGROUND_MODES.find((candidate) => candidate === backgroundMode)
  if (
    row.coloursMode !== 'own' ||
    primaryColor === null ||
    mode === undefined ||
    backgroundColor === null
  ) {
    return { mode: 'inherit' }
  }
  return {
    mode: 'own',
    accent: primaryColor,
    backgroundMode: mode,
    backgroundColour: backgroundColor,
  }
}

/**
 * A stored row as the override it holds. A mode this code does not know, or an
 * owned group missing its values (the table's CHECKs forbid both), reads as
 * following the Property.
 */
export function portalLookOverrideOf(row: PortalLookOverrideRow): PortalLookOverride {
  return {
    photo: photoOfRow(row),
    colours: coloursOfRow(row),
    identity:
      row.identityMode === 'own'
        ? { mode: 'own', wordmark: row.wordmark, logoAssetId: row.logoAssetId }
        : { mode: 'inherit' },
    lookVersion: row.lookVersion,
  }
}

/** The override as its row stores it: a group that follows the Property holds no values. */
export function portalLookColumnsOf(
  override: PortalLookOverride,
): PortalLookOverrideColumns {
  const { photo, colours, identity } = override
  const ownPhoto = photo.mode === 'own' ? photo : null
  const ownColours = colours.mode === 'own' ? colours : null
  const ownIdentity = identity.mode === 'own' ? identity : null
  return {
    photoMode: photo.mode,
    heroAssetId: ownPhoto?.heroAssetId ?? null,
    heroFocalX: ownPhoto?.focalX ?? null,
    heroFocalY: ownPhoto?.focalY ?? null,
    heroAltTexts: ownPhoto ? { ...ownPhoto.altTexts } : {},
    coloursMode: colours.mode,
    primaryColor: ownColours?.accent ?? null,
    backgroundMode: ownColours?.backgroundMode ?? null,
    backgroundColor: ownColours?.backgroundColour ?? null,
    identityMode: identity.mode,
    wordmark: ownIdentity?.wordmark ?? null,
    logoAssetId: ownIdentity?.logoAssetId ?? null,
    lookVersion: override.lookVersion,
  }
}

const PHOTO_SOURCE: Readonly<Record<PortalLookPhotoMode, PortalLookSources['photo']>> = {
  inherit: 'property',
  own: 'portal',
  none: 'none',
}

/** Where each group of a Portal's look comes from; every group is the Property's without an override. */
export function lookSourcesOf(override: PortalLookOverride | null): PortalLookSources {
  if (override === null) return PROPERTY_LOOK_SOURCES
  const { photo, colours, identity } = override
  return {
    photo: PHOTO_SOURCE[photo.mode],
    colours: colours.mode === 'own' ? 'portal' : 'property',
    identity: identity.mode === 'own' ? 'portal' : 'property',
  }
}

const GROUPS_OF_FACET: Readonly<Record<LookFacet, readonly PortalLookGroup[]>> = {
  accent: ['colours'],
  field: ['colours'],
  text: ['colours'],
  wordmark: ['identity'],
  logo: ['identity'],
  photo: ['photo'],
  // Rows written before the split named the photo and the logo together.
  images: ['photo', 'identity'],
}

/** The groups a facet of the look belongs to; the older `images` facet belongs to two. */
export const lookGroupsOfFacet = (facet: LookFacet): readonly PortalLookGroup[] =>
  GROUPS_OF_FACET[facet]

/** The groups any of these facets belongs to, each once, in group order. */
export function lookGroupsOfFacets(
  facets: readonly LookFacet[],
): readonly PortalLookGroup[] {
  const touched = new Set(facets.flatMap((facet) => lookGroupsOfFacet(facet)))
  return PORTAL_LOOK_GROUPS.filter((group) => touched.has(group))
}

/**
 * Whether a change of the Property look's `facet` reaches a Portal whose groups
 * come from `sources`: it does while the Portal follows at least one group the
 * facet belongs to. A Portal with no photo does not follow the Property's photo.
 */
export function facetReachesPortal(
  facet: LookFacet,
  sources: PortalLookSources,
): boolean {
  return lookGroupsOfFacet(facet).some((group) => sources[group] === 'property')
}

/**
 * The Brand Profile with the Portal's own groups laid over it, in the shape it
 * was given, and the Portal's effective look version. With no override it is
 * the profile itself.
 */
export function applyPortalLook<P extends PortalLookProfile>(
  profile: P,
  override: PortalLookOverride | null,
): P {
  if (override === null) return profile
  const { photo, colours, identity } = override
  return {
    ...profile,
    ...(colours.mode === 'own'
      ? {
          primaryColor: colours.accent,
          backgroundMode: colours.backgroundMode,
          backgroundColor: colours.backgroundColour,
        }
      : {}),
    ...(identity.mode === 'own'
      ? { wordmark: identity.wordmark, logoAssetId: identity.logoAssetId }
      : {}),
    ...(photo.mode === 'own'
      ? {
          heroAssetId: photo.heroAssetId,
          heroFocalX: photo.focalX,
          heroFocalY: photo.focalY,
        }
      : {}),
    ...(photo.mode === 'none'
      ? { heroAssetId: null, heroFocalX: null, heroFocalY: null }
      : {}),
    lookVersion: override.lookVersion,
  }
}

/**
 * The Property's content rows with the photo descriptions the Portal shows. A
 * Portal that follows the Property's photo shows its descriptions, so the rows
 * come back as they are. A Portal with no photo describes none. A Portal with
 * its own photo shows that photo's descriptions only, never the Property's of
 * another photo, and a language the Property wrote nothing in gets a row
 * holding the description alone.
 */
export function withPortalHeroAlt<C extends PortalHeroAltContent>(
  contents: readonly C[],
  override: PortalLookOverride | null,
): readonly (C | PortalHeroAltOnlyContent)[] {
  const photo = override?.photo
  if (photo === undefined || photo.mode === 'inherit') return contents
  if (photo.mode === 'none') {
    return contents.map((row) =>
      row.heroAltText === null ? row : { ...row, heroAltText: null },
    )
  }
  const altOf = (locale: string): string | null =>
    isGuestLocale(locale) ? (photo.altTexts[locale] ?? null) : null
  const written = new Set(contents.map((row) => row.locale))
  const altOnly = Object.entries(photo.altTexts).flatMap(
    ([locale, text]): PortalHeroAltOnlyContent[] =>
      isGuestLocale(locale) && !written.has(locale) && isText(text)
        ? [{ locale, title: '', shortDescription: '', heroAltText: text }]
        : [],
  )
  return [
    ...contents.map((row) => ({ ...row, heroAltText: altOf(row.locale) })),
    ...altOnly,
  ]
}

/** What a Portal sees of the Property look before it has an override of its own. */
export type PortalLookBase = Readonly<{
  profile: PortalLookProfile
  /** The Property photo's description in each language of the Portal. */
  heroAltTexts: PortalHeroAltTexts
}>

/**
 * One group's next state. A value left out keeps the Portal's own, or is the
 * Property's when the group becomes the Portal's, so switching a group to its
 * own copies what guests already see and two saves of different fields of one
 * group never overwrite each other.
 */
export type PortalLookChange =
  | Readonly<{ group: 'colours'; mode: 'inherit' }>
  | Readonly<{
      group: 'colours'
      mode: 'own'
      accent?: string
      backgroundMode?: BackgroundMode
      backgroundColour?: string
    }>
  | Readonly<{ group: 'identity'; mode: 'inherit' }>
  | Readonly<{
      group: 'identity'
      mode: 'own'
      /** Null (or only spaces) shows the public display name. */
      wordmark?: string | null
      /** Null shows no logo. */
      logoAssetId?: string | null
    }>
  | Readonly<{ group: 'photo'; mode: 'inherit' }>
  | Readonly<{ group: 'photo'; mode: 'none' }>
  | Readonly<{
      group: 'photo'
      mode: 'own'
      /** Left out, the Portal's own photo stays, or the Property's is copied. */
      heroAssetId?: string
      /** A missing half is the middle; both left out keep the anchor of the same photo and centre a new one. */
      focalX?: number
      focalY?: number
      /** Per language; null (or only spaces) removes one, a language left out keeps its own. */
      altTexts?: Readonly<Partial<Record<GuestLocale, string | null>>>
    }>

export type NextPortalLook = Readonly<{
  override: PortalLookOverride
  /** What guests would see differently, in facet order; empty when nothing visible moved. */
  changedFacets: readonly PortalLookFacet[]
}>

const CENTRE = 0.5
const INVALID_LOOK = 'invalid_theme'

/** The Property's colours as an own group, so copying them moves nothing. */
function propertyColours(profile: PortalLookProfile) {
  return {
    accent: profile.primaryColor,
    backgroundMode:
      BACKGROUND_MODES.find((mode) => mode === profile.backgroundMode) ?? 'auto',
    backgroundColour: profile.backgroundColor,
  } as const
}

function nextColours(
  current: PortalLookColours,
  base: PortalLookBase,
  change: Extract<PortalLookChange, { group: 'colours' }>,
): PortalLookColours {
  if (change.mode === 'inherit') return { mode: 'inherit' }
  const from = current.mode === 'own' ? current : propertyColours(base.profile)
  const next = {
    mode: 'own',
    accent: change.accent ?? from.accent,
    backgroundMode: change.backgroundMode ?? from.backgroundMode,
    backgroundColour: change.backgroundColour ?? from.backgroundColour,
  } as const
  const isEdited =
    change.accent !== undefined ||
    change.backgroundMode !== undefined ||
    change.backgroundColour !== undefined
  // The pair is judged as it will be drawn, after the values left out are filled in.
  if (isEdited) {
    const readout = readLookContrast({
      accent: next.accent,
      backgroundMode: next.backgroundMode,
      backgroundColour: next.backgroundColour,
    })
    if (readout === null) throw portalError(INVALID_LOOK, 'Choose valid colours')
    if (!readout.smallText.isReadable) {
      throw portalError(INVALID_LOOK, 'Page text cannot be read on this background')
    }
  }
  return next
}

function nextIdentity(
  current: PortalLookIdentity,
  base: PortalLookBase,
  change: Extract<PortalLookChange, { group: 'identity' }>,
): PortalLookIdentity {
  if (change.mode === 'inherit') return { mode: 'inherit' }
  const from =
    current.mode === 'own'
      ? current
      : { wordmark: base.profile.wordmark, logoAssetId: base.profile.logoAssetId }
  return {
    mode: 'own',
    wordmark:
      change.wordmark === undefined ? from.wordmark : normaliseWordmark(change.wordmark),
    logoAssetId: change.logoAssetId === undefined ? from.logoAssetId : change.logoAssetId,
  }
}

type OwnPhotoChange = Extract<PortalLookChange, { group: 'photo'; mode: 'own' }>
type OwnPhoto = Extract<PortalLookPhoto, { mode: 'own' }>

/** The photo, anchor and descriptions an own photo starts from before the change is applied. */
function ownPhotoStart(
  current: PortalLookPhoto,
  base: PortalLookBase,
  heroAssetId: string,
): Omit<OwnPhoto, 'mode' | 'heroAssetId'> {
  if (current.mode === 'own' && current.heroAssetId === heroAssetId) return current
  const { heroFocalX, heroFocalY } = base.profile
  if (
    current.mode !== 'own' &&
    heroAssetId === base.profile.heroAssetId &&
    heroFocalX !== null &&
    heroFocalY !== null
  ) {
    // The Property's photo becomes the Portal's: its anchor and descriptions come along.
    return { focalX: heroFocalX, focalY: heroFocalY, altTexts: base.heroAltTexts }
  }
  // A different photo: centred, and described by nothing until someone describes it.
  return { focalX: CENTRE, focalY: CENTRE, altTexts: {} }
}

function changedAltTexts(
  start: PortalHeroAltTexts,
  given: OwnPhotoChange['altTexts'],
): PortalHeroAltTexts {
  if (given === undefined) return start
  const updated = new Set<string>(Object.keys(given))
  const kept = Object.entries(start).filter(([locale]) => !updated.has(locale))
  const written = Object.entries(given).flatMap(
    ([locale, text]): [GuestLocale, string][] => {
      const stored = isGuestLocale(locale) ? normaliseHeroAltText(text ?? null) : null
      return isGuestLocale(locale) && stored !== null ? [[locale, stored]] : []
    },
  )
  return Object.fromEntries([...kept, ...written])
}

function nextPhoto(
  current: PortalLookPhoto,
  base: PortalLookBase,
  change: Extract<PortalLookChange, { group: 'photo' }>,
): PortalLookPhoto {
  if (change.mode !== 'own') return { mode: change.mode }
  const heroAssetId =
    change.heroAssetId ??
    (current.mode === 'own' ? current.heroAssetId : base.profile.heroAssetId)
  if (heroAssetId === null) {
    throw portalError(INVALID_LOOK, 'Choose a photo for this portal')
  }
  const start = ownPhotoStart(current, base, heroAssetId)
  const isAnchorGiven = change.focalX !== undefined || change.focalY !== undefined
  const focal = isAnchorGiven
    ? normaliseFocalPoint(change.focalX ?? CENTRE, change.focalY ?? CENTRE)
    : { x: start.focalX, y: start.focalY }
  return {
    mode: 'own',
    heroAssetId,
    focalX: focal.x,
    focalY: focal.y,
    altTexts: changedAltTexts(start.altTexts, change.altTexts),
  }
}

/** Every group following the Property, at the Property's version: a Portal with no row. */
const followingEverything = (base: PortalLookBase): PortalLookOverride => ({
  photo: { mode: 'inherit' },
  colours: { mode: 'inherit' },
  identity: { mode: 'inherit' },
  lookVersion: base.profile.lookVersion,
})

function withChange(
  current: PortalLookOverride,
  base: PortalLookBase,
  change: PortalLookChange,
): PortalLookOverride {
  switch (change.group) {
    case 'colours':
      return { ...current, colours: nextColours(current.colours, base, change) }
    case 'identity':
      return { ...current, identity: nextIdentity(current.identity, base, change) }
    case 'photo':
      return { ...current, photo: nextPhoto(current.photo, base, change) }
  }
}

/** The photo descriptions a Portal shows under `override`: none while it shows no photo. */
function effectiveAltTexts(
  base: PortalLookBase,
  override: PortalLookOverride,
): PortalHeroAltTexts {
  const { photo } = override
  if (photo.mode === 'own') return photo.altTexts
  return photo.mode === 'none' || base.profile.heroAssetId === null
    ? {}
    : base.heroAltTexts
}

const sameAltTexts = (a: PortalHeroAltTexts, b: PortalHeroAltTexts): boolean => {
  const locales = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...locales].every(
    (locale) => !isGuestLocale(locale) || (a[locale] ?? null) === (b[locale] ?? null),
  )
}

/** Which facets of what guests see differ between two overrides of the same Property look. */
function changedPortalLookFacets(
  base: PortalLookBase,
  before: PortalLookOverride,
  after: PortalLookOverride,
): readonly PortalLookFacet[] {
  const was = applyPortalLook(base.profile, before)
  const is = applyPortalLook(base.profile, after)
  const moved: Readonly<Record<PortalLookFacet, boolean>> = {
    accent: was.primaryColor !== is.primaryColor,
    field:
      was.backgroundMode !== is.backgroundMode ||
      was.backgroundColor !== is.backgroundColor,
    wordmark: was.wordmark !== is.wordmark,
    logo: was.logoAssetId !== is.logoAssetId,
    photo:
      was.heroAssetId !== is.heroAssetId ||
      was.heroFocalX !== is.heroFocalX ||
      was.heroFocalY !== is.heroFocalY ||
      !sameAltTexts(effectiveAltTexts(base, before), effectiveAltTexts(base, after)),
  }
  return PORTAL_LOOK_FACETS.filter((facet) => moved[facet])
}

/**
 * The override after `change`, and what guests would see differently. Its
 * version is the Portal's effective one: unchanged when nothing visible moved
 * (a first row then starts at the Property's version, which the Portal already
 * publishes), one above the effective version when something did. A Portal
 * with no row has the Property's version as its effective one.
 *
 * Refuses an own photo when there is none to keep or copy, an anchor outside the
 * photo, a description over 160 characters, a wordmark over 24, and an own
 * colour pair whose page text could not be read.
 */
export function nextPortalLook(
  current: PortalLookOverride | null,
  base: PortalLookBase,
  change: PortalLookChange,
): NextPortalLook {
  const before = current ?? followingEverything(base)
  const after = withChange(before, base, change)
  const changedFacets = changedPortalLookFacets(base, before, after)
  return {
    override: {
      ...after,
      lookVersion:
        changedFacets.length === 0 ? before.lookVersion : before.lookVersion + 1,
    },
    changedFacets,
  }
}

/** The ledger's source version of a Portal look edit: `look:v<n>`. */
export const portalLookSourceVersion = (lookVersion: number): string =>
  `look:v${lookVersion}`
