// Portal context — operator-only maintenance, composed apart from the request
// surface (build.ts is ratcheted at the file-length limit). Nothing here is
// reachable from a request: the Container exposes it as `portalMaintenanceRuntime`,
// which only scripts/ops reads.

import type { Database } from '#/shared/db'
import { createPortalLegacyPublicationReader } from './infrastructure/repositories/portal-legacy-publication.reader'
import {
  previewPortalChanges,
  publishPortalChanges,
  type PublishPortalChangesDeps,
} from './application/use-cases/publish-portal-changes'
import { republishLegacyPortals } from './application/use-cases/republish-legacy-portals'

/** Bulk republish of live v1/v2 Portals as the current design (round 4, slice 46). */
export const buildPortalMaintenance = (
  db: Database,
  publishDeps: PublishPortalChangesDeps,
) =>
  Object.freeze({
    republishLegacyPortals: republishLegacyPortals({
      reader: createPortalLegacyPublicationReader(db),
      publishPortalChanges: publishPortalChanges(publishDeps),
      previewPortalChanges: previewPortalChanges(publishDeps),
    }),
  })
