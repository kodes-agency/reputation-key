// Portal context — give one Portal its own photo, show no photo on it, or put
// it back to the Property's photo (ADR 0070).
//
// The bytes arrive through the upload endpoint unchanged (purpose `hero`,
// Account Admin with `portal.upload`); this points the Portal's look at that
// asset, moves where it is anchored, or sets its descriptions. A description
// belongs to its photo: an own photo is described only in the Portal's own
// languages and never by the Property's description of another photo, and an
// empty one marks the photo decorative. Only an Account Admin may, and only
// while PORTAL_OWN_LOOK_ENABLED is on; the change waits for this Portal's own
// publish. The photo must be an uploaded photo of the Portal's Property.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { portalError } from '../../domain/errors'
import type { PortalLookChange } from '../../domain/portal-look'
import type { Portal } from '../../domain/types'
import type { PortalLookSaved } from '../dto/portal-look.dto'
import {
  loadPortalForOwnLook,
  savePortalLookChange,
  type PortalLookCommandDeps,
  type PortalLookTarget,
} from '../portal-look-command'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'

type Deps = PortalLookCommandDeps &
  Readonly<{
    /** Where the photo's purpose, Property and state are read from. */
    mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  }>

export type SavePortalLookPhotoInput = PortalLookTarget &
  Readonly<{
    photo:
      | Readonly<{ mode: 'inherit' }>
      | Readonly<{ mode: 'none' }>
      | Readonly<{
          mode: 'own'
          /** An uploaded photo of the Property; left out, the Portal's own stays or the Property's is copied. */
          heroAssetId?: string
          /** Where pages crop around, 0 to 1; a missing half is the middle. */
          focalX?: number
          focalY?: number
          /** Per language of the Portal; null (or only spaces) clears one, a language left out keeps its own. */
          altTexts?: ReadonlyArray<
            Readonly<{ locale: OfferedGuestLocale; text: string | null }>
          >
        }>
  }>

type OwnPhotoInput = Extract<SavePortalLookPhotoInput['photo'], { mode: 'own' }>

/** The descriptions by language, each in a language the Portal is in. */
function altTextsOf(
  portal: Portal,
  altTexts: NonNullable<OwnPhotoInput['altTexts']>,
): Readonly<Partial<Record<GuestLocale, string | null>>> {
  const languages = new Set<GuestLocale>([
    portal.primaryGuestLocale,
    ...portal.additionalGuestLocales,
  ])
  const unknown = altTexts.find(({ locale }) => !languages.has(locale))
  if (unknown !== undefined) {
    throw portalError(
      'locale_not_offered',
      'Describe the photo only in the languages of this portal',
    )
  }
  return Object.fromEntries(altTexts.map(({ locale, text }) => [locale, text]))
}

function photoChangeOf(
  portal: Portal,
  photo: SavePortalLookPhotoInput['photo'],
): PortalLookChange {
  if (photo.mode !== 'own') return { group: 'photo', mode: photo.mode }
  return {
    group: 'photo',
    mode: 'own',
    ...(photo.heroAssetId === undefined ? {} : { heroAssetId: photo.heroAssetId }),
    ...(photo.focalX === undefined ? {} : { focalX: photo.focalX }),
    ...(photo.focalY === undefined ? {} : { focalY: photo.focalY }),
    ...(photo.altTexts === undefined
      ? {}
      : { altTexts: altTextsOf(portal, photo.altTexts) }),
  }
}

export const savePortalLookPhoto =
  (deps: Deps) =>
  async (input: SavePortalLookPhotoInput, ctx: AuthContext): Promise<PortalLookSaved> => {
    const portal = await loadPortalForOwnLook(deps, ctx, input)
    return savePortalLookChange(deps, ctx, portal, photoChangeOf(portal, input.photo))
  }
