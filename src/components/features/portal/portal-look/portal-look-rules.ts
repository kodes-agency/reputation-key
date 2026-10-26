// What a portal's own look editor decides without a screen: the words for what the
// portal follows, the languages and descriptions of its photo, and what each write
// sends. Pure, so the rules and the wording are pinned by tests. Which surface the
// section shows is `portal-look-surface.ts`, which the section reads without the
// editor's code.

import {
  PROPERTY_LOOK_SOURCES,
  type PortalLookColoursInput,
  type PortalLookColoursView,
  type PortalLookIdentityInput,
  type PortalLookPhotoInput,
  type PortalLookView,
} from '#/contexts/portal/application/public-api'
import {
  isOfferedGuestLocale,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import type { FocalPoint } from '../property-look/focal-point'
import type { ColoursDraft } from '../property-look/property-look-colours-section'
import {
  lookIsUnchanged,
  lookProblemOf,
  WORDMARK_MAX,
} from '../property-look/property-look-rules'
import type { PhotoDescriptions } from '../property-look/property-photo-rules'
import type { PropertyHeroWrite } from '../property-look/use-property-look-media'
import type { PortalLookTarget } from './portal-look-types'

/** A portal with no look of its own: every group is the property's. */
export const FOLLOWS_THE_PROPERTY: PortalLookView = {
  sources: PROPERTY_LOOK_SOURCES,
  lookVersion: 0,
  photo: { mode: 'inherit' },
  colours: { mode: 'inherit' },
  identity: { mode: 'inherit' },
}

/** The property's colours, which a portal follows until it has its own. */
export type FollowedColours = Readonly<{
  primaryColor: string
  backgroundColor: string
  backgroundMode?: 'auto' | 'manual'
}>

/** The property's colours, in words, for "Follows the property look, currently …". */
export function coloursFollowedValue(profile: FollowedColours): string {
  const accent = `accent ${profile.primaryColor.toUpperCase()}`
  return profile.backgroundMode === 'manual'
    ? `${accent}, custom background ${profile.backgroundColor.toUpperCase()}`
    : `${accent}, automatic background`
}

/** What a guest sees at the top of a page where the portal follows the property's name and logo. */
export function identityFollowedValue(
  wordmark: string | null | undefined,
  hasLogo: boolean,
): string {
  if (hasLogo) return 'the property’s logo'
  const name = wordmark?.trim() ?? ''
  return name === '' ? 'the business name' : `the wordmark ${name}`
}

// ── Languages and descriptions ───────────────────────────────────────────────

/** The portal's languages, the primary first, each once, as the photo's descriptions are asked for. */
export function offeredLocalesOf(
  portal: Readonly<{
    primaryGuestLocale?: GuestLocale
    additionalGuestLocales?: readonly GuestLocale[]
  }>,
): readonly OfferedGuestLocale[] {
  const primary = portal.primaryGuestLocale ?? 'en'
  return [
    primary,
    ...(portal.additionalGuestLocales ?? []).filter((locale) => locale !== primary),
  ].filter(isOfferedGuestLocale)
}

/** The portal photo's descriptions, by language, as the photo dialog keeps them. */
export function descriptionsOf(
  altTexts: Readonly<Partial<Record<GuestLocale, string>>>,
): PhotoDescriptions {
  return Object.fromEntries(
    Object.entries(altTexts).flatMap(([locale, text]) =>
      isOfferedGuestLocale(locale) && text.trim() !== '' ? [[locale, text.trim()]] : [],
    ),
  )
}

// ── What each write sends ────────────────────────────────────────────────────

type OwnColours = Extract<PortalLookColoursView, { mode: 'own' }>

/** The colours the portal owns, as the colour controls edit them. */
export function coloursDraftOf(colours: OwnColours): ColoursDraft {
  return {
    accent: colours.accentColour.toUpperCase(),
    backgroundMode: colours.backgroundMode,
    field: colours.backgroundColour.toUpperCase(),
  }
}

/** The input of `savePortalLookColours` for a draft; the typed background only while it is custom. */
export function coloursInputOf(
  target: PortalLookTarget,
  draft: ColoursDraft,
): PortalLookColoursInput {
  return {
    ...target,
    colours: {
      mode: 'own',
      accentColour: draft.accent,
      backgroundMode: draft.backgroundMode,
      ...(draft.backgroundMode === 'manual' ? { backgroundColour: draft.field } : {}),
    },
  }
}

// The colour rules are the Property look's: they read a whole look, of which a
// portal's colours are every part but the wordmark.
const withoutWordmark = (draft: ColoursDraft) => ({ ...draft, wordmark: '' })

/** Why the colours cannot be saved, in words for the manager; null when they can. */
export function coloursProblemOf(draft: ColoursDraft): string | null {
  return lookProblemOf(withoutWordmark(draft))
}

/** Whether two colour drafts would write the same thing. */
export function coloursAreUnchanged(saved: ColoursDraft, draft: ColoursDraft): boolean {
  return lookIsUnchanged(withoutWordmark(saved), withoutWordmark(draft))
}

/** Why a wordmark cannot be saved; null when it can. */
export function wordmarkProblemOf(wordmark: string): string | null {
  return wordmark.trim().length > WORDMARK_MAX
    ? `The wordmark can be at most ${WORDMARK_MAX} characters`
    : null
}

/** The input of `savePortalLookIdentity` for a wordmark; empty means the display name shows. */
export function wordmarkInputOf(
  target: PortalLookTarget,
  wordmark: string,
): PortalLookIdentityInput {
  const trimmed = wordmark.trim()
  return {
    ...target,
    identity: { mode: 'own', wordmark: trimmed === '' ? null : trimmed },
  }
}

/** The input of `savePortalLookIdentity` for the logo: an uploaded one, or null for none. */
export function logoInputOf(
  target: PortalLookTarget,
  assetId: string | null,
): PortalLookIdentityInput {
  return { ...target, identity: { mode: 'own', logoAssetId: assetId } }
}

/** The input of `savePortalLookPhoto` for a moved focus point; the photo itself stays. */
export function focalInputOf(
  target: PortalLookTarget,
  focal: FocalPoint,
): PortalLookPhotoInput {
  return { ...target, photo: { mode: 'own', focalX: focal.x, focalY: focal.y } }
}

/** The input of `savePortalLookPhoto` for what the photo dialog writes: a photo, its focus point, its descriptions. */
export function photoInputOf(
  target: PortalLookTarget,
  write: Omit<PropertyHeroWrite, 'propertyId'>,
): PortalLookPhotoInput {
  if (write.assetId === null) return { ...target, photo: { mode: 'none' } }
  return {
    ...target,
    photo: {
      mode: 'own',
      heroAssetId: write.assetId,
      ...(write.focalX === undefined ? {} : { focalX: write.focalX }),
      ...(write.focalY === undefined ? {} : { focalY: write.focalY }),
      ...(write.altTexts === undefined ? {} : { altTexts: write.altTexts }),
    },
  }
}
