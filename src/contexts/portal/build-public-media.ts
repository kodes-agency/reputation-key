import { createHash } from 'node:crypto'
import { resolvePortalMediaUrls } from './application/resolve-portal-media-urls'
import {
  servePortalMedia,
  type ServePortalMediaDeps,
} from './application/use-cases/serve-portal-media'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'

/** The public reader and staff appearance reader share current media admission. */
export function buildPortalPublicMedia(
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds' | 'findForPublicRead'>,
  objectStore: ServePortalMediaDeps['objectStore'],
  deps: Omit<ServePortalMediaDeps, 'mediaRepo' | 'objectStore' | 'sha256Hex'>,
) {
  return {
    serveMedia: servePortalMedia({
      ...deps,
      mediaRepo,
      objectStore,
      sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    }),
    mediaUrls: resolvePortalMediaUrls({ mediaRepo }),
  }
}
