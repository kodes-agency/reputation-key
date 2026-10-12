// The page and the words of a version can differ: the words list every tile the
// version published, the page draws only those whose address is still approved
// (the live rules). The dialog says so, so a tile in the list that is missing
// from the phone is not a mystery.

import type { PortalVersionDetail } from '#/contexts/portal/application/public-api'

export const TILES_LEFT_OUT_NOTE =
  'Tiles whose address is no longer approved are left out of the page.'

/**
 * `listed`: tiles the version lists, or null when it lists none to compare
 * (the Linktree is off, or the words have not loaded). `drawn`: tiles on the page.
 */
export function tilesLeftOutNote(counts: {
  listed: number | null
  drawn: number
}): string | null {
  return counts.listed !== null && counts.listed > counts.drawn
    ? TILES_LEFT_OUT_NOTE
    : null
}

/** The tiles a version lists in words, or null where there is nothing to compare with the page. */
export function listedTileCount(detail: PortalVersionDetail | null): number | null {
  return detail === null || detail.content.linktreeEnabled === false
    ? null
    : detail.content.links.length
}
