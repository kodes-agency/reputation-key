// Portal context — a Portal's own look as its editor shows it (ADR 0070).
//
// The override names its photo and logo by asset id; what the editor shows of
// them is what a page would draw, resolved the way the Property look's media
// are (`resolvePropertyLookMedia`: the right purpose, of this Property and still
// servable). An own photo that was taken down therefore reads as no photo, the
// same no-photo look its published page falls back to, and the editor says so.

import type { PortalLookOverride } from '../domain/portal-look'
import { lookSourcesOf } from '../domain/portal-look'
import type { PortalLookSaved, PortalLookView } from './dto/portal-look.dto'
import type { PropertyLookMedia } from './property-look-media'

/** The media profile an override's own groups name, for `resolvePropertyLookMedia`. */
export function portalLookMediaProfileOf(override: PortalLookOverride) {
  const { photo, identity } = override
  return {
    heroAssetId: photo.mode === 'own' ? photo.heroAssetId : null,
    heroFocalX: photo.mode === 'own' ? photo.focalX : null,
    heroFocalY: photo.mode === 'own' ? photo.focalY : null,
    logoAssetId: identity.mode === 'own' ? identity.logoAssetId : null,
  }
}

/**
 * The editor's view of an override, given the media its own groups resolve to
 * (`portalLookMediaProfileOf` then `resolvePropertyLookMedia`). A group that
 * follows the Property carries nothing of its own.
 */
export function portalLookViewOf(
  override: PortalLookOverride,
  media: PropertyLookMedia,
): PortalLookView {
  const { photo, colours, identity } = override
  return {
    sources: lookSourcesOf(override),
    lookVersion: override.lookVersion,
    photo: photo.mode === 'own' ? { ...photo, hero: media.hero } : photo,
    colours:
      colours.mode === 'own'
        ? {
            mode: 'own',
            accentColour: colours.accent,
            backgroundMode: colours.backgroundMode,
            backgroundColour: colours.backgroundColour,
          }
        : colours,
    identity: identity.mode === 'own' ? { ...identity, logo: media.logo } : identity,
  }
}

/** What a save answers about the Portal it saved. */
export function portalLookSavedOf(
  portalId: string,
  override: PortalLookOverride,
  changedFacets: readonly unknown[],
): PortalLookSaved {
  return {
    portalId,
    sources: lookSourcesOf(override),
    lookVersion: override.lookVersion,
    changed: changedFacets.length > 0,
  }
}
