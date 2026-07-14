// Portal context — build function.
// Wires portal repos, storage, and all portal use cases.
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalPublicApi } from './application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createPortalRepository } from './infrastructure/repositories/portal.repository'
import { createPortalLinkRepository } from './infrastructure/repositories/portal-link.repository'
import { createPortalGroupRepository } from './infrastructure/repositories/portal-group.repository'
import { createLinkResolverPort } from './infrastructure/repositories/link-resolver.repository'
import { createS3StorageAdapter } from './infrastructure/adapters/s3-storage.adapter'
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
import { getPortalQrUrl } from './application/use-cases/get-portal-qr-url'
import { listPortalLinks } from './application/use-cases/list-portal-links'
import { createPortalGroup } from './application/use-cases/create-portal-group'
import { updatePortalGroup } from './application/use-cases/update-portal-group'
import { listPortalGroups } from './application/use-cases/list-portal-groups'
import { getPortalGroup } from './application/use-cases/get-portal-group'
import { softDeletePortalGroup } from './application/use-cases/soft-delete-portal-group'
import { addPortalToGroup } from './application/use-cases/add-portal-to-group'
import { removePortalFromGroup } from './application/use-cases/remove-portal-from-group'
import { portalId, portalGroupId } from '#/shared/domain/ids'
import type { Queue } from 'bullmq'

type PortalContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox/infrastructure/outbox-repository').OutboxRepository
  clock: () => Date
  propertyApi: PropertyPublicApi
  staffPublicApi: StaffPublicApi
  baseUrl: string
  idGen: () => string
  queue: Queue | undefined
  storageConfig: Readonly<{
    accessKey: string
    secretKey: string
    bucketName: string
    region: string
  }>
}>

export const buildPortalContext = (deps: PortalContextDeps) => {
  const portalRepo = createPortalRepository(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db)
  const portalGroupRepo = createPortalGroupRepository(deps.db)
  const linkResolver = createLinkResolverPort(deps.db)
  const storage = createS3StorageAdapter({
    accessKey: deps.storageConfig.accessKey,
    secretKey: deps.storageConfig.secretKey,
    bucketName: deps.storageConfig.bucketName,
    region: deps.storageConfig.region,
  })
  const portalIdGen = () => portalId(deps.idGen())
  const portalGroupIdGen = () => portalGroupId(deps.idGen())
  const linkIdGen = () => deps.idGen()
  const useCases = {
    createPortal: createPortal({
      portalRepo,
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      idGen: portalIdGen,
      clock: deps.clock,
    }),
    updatePortal: updatePortal({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    getPortal: getPortal({ portalRepo, staffPublicApi: deps.staffPublicApi }),
    listPortals: listPortals({ portalRepo, staffPublicApi: deps.staffPublicApi }),
    softDeletePortal: softDeletePortal({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    createLinkCategory: createLinkCategory({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLinkCategory: updateLinkCategory({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    deleteLinkCategory: deleteLinkCategory({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    reorderCategories: reorderCategories({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    createLink: createLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLink: updateLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    deleteLink: deleteLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    reorderLinks: reorderLinks({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    requestUploadUrl: requestUploadUrl({
      portalRepo,
      storage,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
    }),
    finalizeUpload: finalizeUpload({
      portalRepo,
      storage,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
      queue: deps.queue,
    }),
    getPortalQrUrl: getPortalQrUrl({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      baseUrl: deps.baseUrl,
    }),
    listPortalLinks: listPortalLinks({
      portalLinkRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    createPortalGroup: createPortalGroup({
      portalGroupRepo,
      portalRepo,
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      idGen: portalGroupIdGen,
      clock: deps.clock,
    }),
    updatePortalGroup: updatePortalGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    listPortalGroups: listPortalGroups({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    getPortalGroup: getPortalGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    softDeletePortalGroup: softDeletePortalGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    addPortalToGroup: addPortalToGroup({
      portalGroupRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
    removePortalFromGroup: removePortalFromGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      clock: deps.clock,
    }),
  } as const

  // ── Public API — consumed by guest context and other cross-context callers ──

  const publicApi: PortalPublicApi = {
    resolvePortalContext: (portalIdParam) =>
      portalRepo.resolvePortalContext(portalIdParam),
    getPortalInfo: (orgId, pid) =>
      portalRepo
        .findById(orgId, pid)
        .then((p) => (p ? { id: p.id, name: p.name, isActive: p.isActive } : null)),
    findPublicPortalBySlug: (propertySlug, portalSlug) =>
      portalRepo.findPublicPortalBySlug(propertySlug, portalSlug),
  }

  const portalGroupPublicApi: import('./application/public-api').PortalGroupPublicApi = {
    findGroupForPortal: async (orgId, pid) => {
      const group = await portalGroupRepo.findGroupForPortal(orgId, pid)
      if (!group) return null
      return { id: group.id, propertyId: group.propertyId, name: group.name }
    },
    getGroupPortalIds: (orgId, groupId) =>
      portalGroupRepo.getGroupPortalIds(orgId, groupId),
    findGroupIdsByPortalIds: (orgId, portalIds) =>
      portalRepo.findGroupIdsByPortalIds(orgId, portalIds),
  }

  return {
    publicApi: {
      portal: publicApi,
      portalGroup: portalGroupPublicApi,
    },
    internal: {
      repos: {
        portalRepo,
        portalLinkRepo,
        portalGroupRepo,
        linkResolver,
      },
      useCases,
      storage,
    },
  } as const
}
