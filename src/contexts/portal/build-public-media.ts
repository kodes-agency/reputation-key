import { createHash } from 'node:crypto'
import { resolvePortalMediaUrls } from './media/resolve-portal-media-urls.server'
import {
  servePortalMedia,
  type ServePortalMediaDeps,
} from './media/serve-portal-media.server'
import type { PortalMediaAssetRepository } from './media/portal-media-asset-repository.port.server'

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
