// Portal context — build function.
// Wires portal repos, storage, and all portal use cases.
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createPortalRepository } from './infrastructure/repositories/portal.repository'
import { createPortalLinkRepository } from './infrastructure/repositories/portal-link.repository'
import { createS3StorageAdapter } from './infrastructure/adapters/r2-storage.adapter'
import { createPortal } from './application/use-cases/create-portal'
import { updatePortal } from './application/use-cases/update-portal'
import { getPortal } from './application/use-cases/get-portal'
import { listPortals } from './application/use-cases/list-portals'
import { softDeletePortal } from './application/use-cases/soft-delete-portal'
import { createLinkCategory } from './application/use-cases/create-link-category'
import { updateLinkCategory } from './application/use-cases/update-link-category'
import { deleteLinkCategory } from './application/use-cases/delete-link-category'
import { reorderCategories } from './application/use-cases/reorder-categories'
import { createLink } from './application/use-cases/create-link'
import { updateLink } from './application/use-cases/update-link'
import { deleteLink } from './application/use-cases/delete-link'
import { reorderLinks } from './application/use-cases/reorder-links'
import { requestUploadUrl } from './application/use-cases/request-upload-url'
import { finalizeUpload } from './application/use-cases/finalize-upload'
import { portalId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type PortalContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  propertyApi: PropertyPublicApi
}>

export const buildPortalContext = (deps: PortalContextDeps) => {
  const portalRepo = createPortalRepository(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db)
  const storage = createS3StorageAdapter()
  const portalIdGen = () => portalId(randomUUID())
  const linkIdGen = () => randomUUID()

  const useCases = {
    createPortal: createPortal({
      portalRepo,
      propertyApi: deps.propertyApi,
      events: deps.events,
      idGen: portalIdGen,
      clock: deps.clock,
    }),
    updatePortal: updatePortal({
      portalRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    getPortal: getPortal({ portalRepo }),
    listPortals: listPortals({ portalRepo }),
    softDeletePortal: softDeletePortal({
      portalRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    createLinkCategory: createLinkCategory({
      portalRepo,
      portalLinkRepo,
      events: deps.events,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLinkCategory: updateLinkCategory({
      portalLinkRepo,
      clock: deps.clock,
    }),
    deleteLinkCategory: deleteLinkCategory({ portalLinkRepo }),
    reorderCategories: reorderCategories({
      portalLinkRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    createLink: createLink({
      portalLinkRepo,
      events: deps.events,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLink: updateLink({ portalLinkRepo, clock: deps.clock }),
    deleteLink: deleteLink({ portalLinkRepo }),
    reorderLinks: reorderLinks({
      portalLinkRepo,
      events: deps.events,
      clock: deps.clock,
    }),
    requestUploadUrl: requestUploadUrl({
      portalRepo,
      storage,
    }),
    finalizeUpload: finalizeUpload({
      portalRepo,
      storage,
      clock: deps.clock,
    }),
  } as const

  return { useCases, storage, portalRepo, portalLinkRepo } as const
}
