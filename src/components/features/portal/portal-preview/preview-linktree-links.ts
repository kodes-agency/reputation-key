// The Linktree tiles of a previewed page, in the shape the guest page's own
// Linktree takes. A tile whose address is not approved becomes a placeholder
// (a dashed variant of the real tile), so a manager sees why a tile they made
// is missing from the page; every other tile is drawn exactly as guests get it.

import type { ImmersiveLinktreeLink } from '#/components/features/guest'
import type { PortalPreviewLink } from '#/contexts/portal/application/public-api'
import { TILE_PLACEHOLDER_NOTE } from './portal-preview-rules'

const UNTITLED_LINK = 'Untitled link'

export function previewLinktreeLink(link: PortalPreviewLink): ImmersiveLinktreeLink {
  const label = link.label === '' ? UNTITLED_LINK : link.label
  if (link.state === 'ready') {
    return {
      id: link.id,
      iconKey: link.iconKey,
      imageUrl: link.imageUrl,
      label,
      line: link.line,
      fallbackFrom: link.fallbackFrom,
    }
  }
  // Publishing leaves the tile out, so its photo and line are not shown either.
  return {
    id: link.id,
    iconKey: link.iconKey,
    imageUrl: null,
    label,
    line: null,
    fallbackFrom: link.fallbackFrom,
    placeholder: { kind: link.state, note: TILE_PLACEHOLDER_NOTE[link.state] },
  }
}
