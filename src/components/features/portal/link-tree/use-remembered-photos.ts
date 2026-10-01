import { useState } from 'react'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import { rememberPhotos, type PhotoMemory } from './linktree-photo-rules'

/**
 * Each tile's last photo for the session. Noted while rendering (the supported
 * way to derive state from props), so no frame shows the tile without it.
 */
export function useRememberedPhotos(
  links: ReadonlyArray<PortalLinktreeLink>,
): PhotoMemory {
  const [photos, setPhotos] = useState<PhotoMemory>({})
  const remembered = rememberPhotos(photos, links)
  if (remembered !== photos) setPhotos(remembered)
  return remembered
}
