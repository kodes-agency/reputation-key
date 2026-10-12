// Portal editor — the pure rules for a tile's photo: where it is shown from, and
// what choosing a photo or an icon saves. A tile wears an icon or a photo, never
// both, so choosing an icon over a photo takes the photo off in the same write.

import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'

type LinkWithPhoto = Pick<PortalLinktreeLink, 'id' | 'imageAssetId'>

/** The address of a tile's photo, which the app serves from its own origin; null with no photo. */
export function linkPhotoUrl(
  link: Pick<PortalLinktreeLink, 'imageAssetId'>,
): string | null {
  return link.imageAssetId === null ? null : portalMediaPublicPath(link.imageAssetId)
}

/** The photo each tile last had in this session, by link id. */
export type PhotoMemory = Readonly<Record<string, string>>

/**
 * `memory` with the photo of every tile that has one noted. A tile that has been
 * given an icon keeps its entry, so its photo can be chosen again without being
 * uploaded again. Returns `memory` itself when nothing is new.
 */
export function rememberPhotos(
  memory: PhotoMemory,
  links: ReadonlyArray<Pick<PortalLinktreeLink, 'id' | 'imageAssetId'>>,
): PhotoMemory {
  const fresh = links.flatMap(({ id, imageAssetId }) =>
    imageAssetId !== null && memory[id] !== imageAssetId
      ? [[id, imageAssetId] as const]
      : [],
  )
  if (fresh.length === 0) return memory
  return { ...memory, ...Object.fromEntries(fresh) }
}

/** The photo the picker offers: the tile's own, or else the one an icon replaced. */
export function photoOnOffer(
  link: Pick<PortalLinktreeLink, 'imageAssetId'>,
  remembered: string | null,
): string | null {
  return link.imageAssetId ?? remembered
}

/** The `updateLink` input for choosing an icon. */
export function iconChoiceWrite(link: LinkWithPhoto, iconKey: PortalLinkIconKey) {
  return {
    linkId: link.id,
    iconKey,
    ...(link.imageAssetId === null ? {} : { imageAssetId: null }),
  }
}

/** The icons asked for and not yet saved, by link id. */
export type IconChoices = Readonly<Record<string, PortalLinkIconKey>>

/**
 * The tiles as the person has just left them: an icon asked for is shown at once
 * (and takes a photo off, as saving it does), before the server has answered.
 * Returns `links` itself when nothing is asked for.
 */
export function applyIconChoices<
  Link extends Pick<PortalLinktreeLink, 'id' | 'iconKey' | 'imageAssetId'>,
>(links: ReadonlyArray<Link>, choices: IconChoices): ReadonlyArray<Link> {
  if (Object.keys(choices).length === 0) return links
  return links.map((link) => {
    const iconKey = choices[link.id]
    return iconKey === undefined ? link : { ...link, iconKey, imageAssetId: null }
  })
}

/** The `updateLink` input for putting a photo on the tile: one just uploaded, or one chosen again. The icon stays, for when the photo goes. */
export function photoChoiceWrite(
  link: Pick<PortalLinktreeLink, 'id'>,
  imageAssetId: string,
) {
  return { linkId: link.id, imageAssetId }
}

/** The name of the dashed tile at the end of the picker. */
export const uploadTileLabel = (hasPhoto: boolean): string =>
  hasPhoto ? 'Replace photo' : 'Upload a photo instead of an icon'
