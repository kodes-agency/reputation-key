// Portal context — build function.
// Wires portal repos, storage, and all portal use cases.
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { IdentityPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicApi } from './application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createPortalRepository } from './infrastructure/repositories/portal.repository'
import { createPortalLinkRepository } from './infrastructure/repositories/portal-link.repository'
import { createPortalGroupRepository } from './infrastructure/repositories/portal-group.repository'
import { createLinkResolverPort } from './infrastructure/repositories/link-resolver.repository'
import { createS3StorageAdapter } from './infrastructure/adapters/s3-storage.adapter'
import { createPortalTokenRepository } from './infrastructure/repositories/portal-token.repository'
import { createPortalPublicationRepository } from './infrastructure/repositories/portal-publication.repository'
import { createPortalScopeRepository } from './infrastructure/repositories/portal-scope.repository'
import { createPortalResponsibleManagerRepository } from './infrastructure/repositories/portal-responsible-manager.repository'
import type { PortalStoragePort } from './application/ports/storage.port'
import { createPortalTokenCodec } from './infrastructure/adapters/portal-token-codec'
import { createPortal } from './application/use-cases/create-portal'
import { updatePortal } from './application/use-cases/update-portal'
import { rollbackPortalPublication } from './application/use-cases/rollback-portal-publication'
import { getPortal } from './application/use-cases/get-portal'
import { getPortalPublicationHistory } from './application/use-cases/get-portal-publication-history'
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
import { listPortalLinks } from './application/use-cases/list-portal-links'
import { createPortalGroup } from './application/use-cases/create-portal-group'
import { updatePortalGroup } from './application/use-cases/update-portal-group'
import { listPortalGroups } from './application/use-cases/list-portal-groups'
import { getPortalGroup } from './application/use-cases/get-portal-group'
import { softDeletePortalGroup } from './application/use-cases/soft-delete-portal-group'
import { addPortalToGroup } from './application/use-cases/add-portal-to-group'
import { removePortalFromGroup } from './application/use-cases/remove-portal-from-group'
import { issuePortalToken } from './application/use-cases/issue-portal-token'
import { rotatePortalToken } from './application/use-cases/rotate-portal-token'
import { revokePortalTokens } from './application/use-cases/revoke-portal-tokens'
import { resolvePublicPortalToken } from './application/use-cases/resolve-public-portal-token'
import { completeContentReview } from './application/use-cases/complete-content-review'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './application/use-cases/portal-responsible-managers'
import { createPortalWorkflowFactStore } from './infrastructure/portal-workflow-fact-store'
import { createAtomicPortalCommandStore } from './infrastructure/portal-command-store'
import { createPortalUploadIssuanceStore } from './infrastructure/portal-upload-issuance-store'
import { decidePublicExecution } from '#/shared/auth/execution-policy'
import { portalId, portalGroupId, userId } from '#/shared/domain/ids'
import { listEligiblePortalManagers } from './application/portal-manager-eligibility'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createProcessIssuedPortalImage } from './infrastructure/jobs/process-image.job'
import { registerPortalConsumers } from './infrastructure/outbox-consumers'

type PortalContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  propertyApi: PropertyPublicApi & PropertyGoogleReviewDestinationPublicApi
  staffPublicApi: StaffPublicApi
  identityPublicApi: IdentityPublicApi
  baseUrl: string
  idGen: () => string
  tokenHashSecret: string
  logger: LoggerPort
  storageConfig: Readonly<{
    accessKey: string
    secretKey: string
    bucketName: string
    region: string
    internalEndpoint?: string
    presignEndpoint?: string
    forcePathStyle?: boolean
  }>
  /** BQC-6.1: optional storage adapter override (simulations/tests inject an
   * in-memory storage; absent = the S3 adapter built from storageConfig). */
  storage?: PortalStoragePort
}>

export const buildPortalContext = (deps: PortalContextDeps) => {
  const portalRepo = createPortalRepository(deps.db)
  const portalCommandStore = createAtomicPortalCommandStore(deps.db, deps.events)
  const portalUploadStore = createPortalUploadIssuanceStore(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db)
  const portalGroupRepo = createPortalGroupRepository(deps.db)
  const portalTokenRepo = createPortalTokenRepository(deps.db)
  const portalPublicationRepo = createPortalPublicationRepository(deps.db)
  const portalScopeRepo = createPortalScopeRepository(deps.db)
  const portalResponsibleManagerRepo = createPortalResponsibleManagerRepository(deps.db)
  const portalTokenCodec = createPortalTokenCodec({ secret: deps.tokenHashSecret })
  const linkResolver = createLinkResolverPort(deps.db)
  const portalWorkflowFactStore = createPortalWorkflowFactStore(deps.db, deps.events)
  const storage =
    deps.storage ??
    createS3StorageAdapter({
      accessKey: deps.storageConfig.accessKey,
      secretKey: deps.storageConfig.secretKey,
      bucketName: deps.storageConfig.bucketName,
      region: deps.storageConfig.region,
      internalEndpoint: deps.storageConfig.internalEndpoint,
      presignEndpoint: deps.storageConfig.presignEndpoint,
      forcePathStyle: deps.storageConfig.forcePathStyle,
    })
  const portalIdGen = () => portalId(deps.idGen())
  const portalGroupIdGen = () => portalGroupId(deps.idGen())
  const linkIdGen = () => deps.idGen()
  const processIssuedPortalImage = createProcessIssuedPortalImage({
    storage,
    uploadStore: portalUploadStore,
    clock: deps.clock,
  })
  const useCases = {
    resolvePortalManagementScope: portalScopeRepo.resolvePortal,
    resolvePortalGroupManagementScope: portalScopeRepo.resolveGroup,
    resolvePortalCategoryManagementScope: portalScopeRepo.resolveCategory,
    resolvePortalLinkManagementScope: portalScopeRepo.resolveLink,
    listPortalManagementPropertyIds: portalScopeRepo.listPortalPropertyIds,
    listPortalResponsibleManagers: listPortalResponsibleManagers({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityPublicApi,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    updatePortalResponsibleManagers: updatePortalResponsibleManagers({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityPublicApi,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
      events: deps.events,
    }),
    completeContentReview: completeContentReview({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      portalGroupLookup: portalGroupRepo,
      factStore: portalWorkflowFactStore,
      clock: deps.clock,
    }),
    createPortal: createPortal({
      portalRepo,
      commandStore: portalCommandStore,
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      identityPublicApi: deps.identityPublicApi,
      idGen: portalIdGen,
      clock: deps.clock,
    }),
    updatePortal: updatePortal({
      portalRepo,
      commandStore: portalCommandStore,
      publicationRepo: portalPublicationRepo,
      propertyGoogleReviewDestinationApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    rollbackPortalPublication: rollbackPortalPublication({
      portalRepo,
      publicationRepo: portalPublicationRepo,
      commandStore: portalCommandStore,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    getPortal: getPortal({
      portalRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    getPortalPublicationHistory: getPortalPublicationHistory({
      portalRepo,
      publicationRepo: portalPublicationRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    listPortals: listPortals({ portalRepo, staffPublicApi: deps.staffPublicApi }),
    softDeletePortal: softDeletePortal({
      portalRepo,
      commandStore: portalCommandStore,
      staffPublicApi: deps.staffPublicApi,
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
      uploadStore: portalUploadStore,
      storage,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    finalizeUpload: finalizeUpload({
      portalRepo,
      uploadStore: portalUploadStore,
      storage,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
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
      commandStore: portalCommandStore,
      staffPublicApi: deps.staffPublicApi,
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
    issuePortalToken: issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: portalTokenCodec,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      outboxRepo: deps.outboxRepo,
      idGen: deps.idGen,
      baseUrl: deps.baseUrl,
      clock: deps.clock,
    }),
    rotatePortalToken: rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: portalTokenCodec,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      outboxRepo: deps.outboxRepo,
      idGen: deps.idGen,
      clock: deps.clock,
      baseUrl: deps.baseUrl,
      defaultGracePeriodSeconds: 15 * 60,
    }),
    revokePortalTokens: revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
      outboxRepo: deps.outboxRepo,
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
        .then((p) =>
          p ? { id: p.id, name: p.name, publicationState: p.publicationState } : null,
        ),
    findPublicPortalByToken: async (rawToken) => {
      const outcome = await resolvePublicPortalToken({
        tokenCodec: portalTokenCodec,
        portalPublicationRepo,
        getGoogleReviewDestination: deps.propertyApi.getGoogleReviewDestination,
        decidePublic: decidePublicExecution,
        reportGoogleDestinationFailure: (error) =>
          deps.logger.warn(
            { err: error },
            'Portal Google review destination unavailable — serving degraded gateway',
          ),
        clock: deps.clock,
      })(rawToken)
      return outcome.status === 'found'
        ? { status: 'found', result: outcome.data }
        : { status: 'unavailable' }
    },
    getResponsibleManagerUserIds: async (orgId, pid) => {
      const portal = await portalRepo.findById(orgId, pid)
      if (!portal) return []
      const [assignments, eligible] = await Promise.all([
        portalResponsibleManagerRepo.listActive(orgId, pid),
        listEligiblePortalManagers(deps, orgId, portal.propertyId),
      ])
      const eligibleIds = new Set(eligible.map((manager) => manager.userId))
      return assignments
        .filter((assignment) => eligibleIds.has(assignment.userId))
        .map((assignment) => userId(assignment.userId))
    },
  }

  const portalGroupPublicApi: import('./application/public-api').PortalGroupPublicApi = {
    findGroupForPortal: async (orgId, pid, asOf) => {
      const group = await portalGroupRepo.findGroupForPortal(orgId, pid, asOf)
      if (!group) return null
      return { id: group.id, propertyId: group.propertyId, name: group.name }
    },
    getGroupPortalIds: (orgId, groupId) =>
      portalGroupRepo.getGroupPortalIds(orgId, groupId),
    findGroupIdsByPortalIds: (orgId, portalIds) =>
      portalGroupRepo.findGroupIdsByPortalIds(orgId, portalIds),
    portalGroupBelongsToProperty: async (orgId, pid, groupId) => {
      const group = await portalGroupRepo.findById(orgId, groupId)
      return group?.propertyId === pid
    },
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
        portalTokenRepo,
        portalPublicationRepo,
        portalResponsibleManagerRepo,
        portalUploadStore,
        linkResolver,
      },
      useCases,
      storage,
      registerOutboxConsumers: () => {
        if (!deps.outboxRepo) {
          throw new Error('Portal upload outbox repository is unavailable')
        }
        registerPortalConsumers({
          processIssuedPortalImage,
          receipts: deps.outboxRepo,
        })
      },
    },
  } as const
}
