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

/** The `updateLink` input for choosing an icon. */
export function iconChoiceWrite(link: LinkWithPhoto, iconKey: PortalLinkIconKey) {
  return {
    linkId: link.id,
    iconKey,
    ...(link.imageAssetId === null ? {} : { imageAssetId: null }),
  }
}

/** The `updateLink` input for a freshly uploaded photo. The icon stays, for when the photo goes. */
export function photoChoiceWrite(
  link: Pick<PortalLinktreeLink, 'id'>,
  imageAssetId: string,
) {
  return { linkId: link.id, imageAssetId }
}

/** The name of the dashed tile at the end of the picker. */
export const uploadTileLabel = (hasPhoto: boolean): string =>
  hasPhoto ? 'Replace photo' : 'Upload a photo instead of an icon'
