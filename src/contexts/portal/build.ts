// Portal context — build function.
// Wires portal repos, storage, and all portal use cases.
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import type { ConsumerRegistry } from '#/shared/outbox'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import {
  createCurrentPortalIdReader,
  createPortalRepository,
} from './infrastructure/repositories/portal.repository'
import { createPortalResponsibilityRuntime } from './application/portal-responsibility-runtime'
import { createPortalLinkRepository } from './infrastructure/repositories/portal-link.repository'
import { createPortalGroupRepository } from './infrastructure/repositories/portal-group.repository'
import { createS3StorageAdapter } from './infrastructure/adapters/s3-storage.adapter'
import { createPortalTokenRepository } from './infrastructure/repositories/portal-token.repository'
import { createPortalPublicationRepository } from './infrastructure/repositories/portal-publication.repository'
import { createPortalScopeRepository } from './infrastructure/repositories/portal-scope.repository'
import { createPortalResponsibleManagerRepository } from './infrastructure/repositories/portal-responsible-manager.repository'
import {
  createPortalAccessArtifactRepository,
  type ResolvePublishedAccessArtifactInput,
} from './infrastructure/repositories/portal-access-artifact.repository'
import { createPortalApprovedDestinationRepository } from './infrastructure/repositories/portal-approved-destination.repository'
import { createPortalExperienceRepository } from './infrastructure/repositories/portal-experience.repository'
import { createPortalHealthRepository } from './infrastructure/repositories/portal-health.repository'
import { createPortalAiReplyBrandProfileAuthority } from './infrastructure/ai-reply-brand-profile-authority'
import type { PortalStoragePort } from './application/ports/storage.port'
import { createPortalTokenCodec } from './infrastructure/adapters/portal-token-codec'
import { createPortalOrganizationExportContributor } from './infrastructure/adapters/portal-organization-export.adapter'
import { createPortalOrganizationLifecycleContributor } from './infrastructure/adapters/portal-organization-lifecycle.adapter'
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
import {
  resolvePublicPortalToken,
  type GuestLocalePreference,
  type ResolvePublicPortalTokenOutcome,
} from './application/use-cases/resolve-public-portal-token'
import { completeContentReview } from './application/use-cases/complete-content-review'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './application/use-cases/portal-responsible-managers'
import { getPortalContactRequestManagerAuthorityFacts } from './application/use-cases/portal-contact-request-authority'
import { createPortalWorkflowFactStore } from './infrastructure/portal-workflow-fact-store'
import { createAtomicPortalCommandStore } from './infrastructure/portal-command-store'
import { createPortalUploadIssuanceStore } from './infrastructure/portal-upload-issuance-store'
import { decidePublicExecution } from '#/shared/auth/execution-policy'
import {
  portalGroupId,
  portalId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createProcessIssuedPortalImage } from './infrastructure/jobs/process-image.job'
import { registerPortalConsumers } from './infrastructure/outbox-consumers'
import { registerPortalHealthConsumers } from './infrastructure/portal-health-outbox-consumers'
import { createPortalHealthReconciliationStore } from './infrastructure/portal-health-reconciliation-store'
import { createPortalDestinationNetworkValidator } from './infrastructure/adapters/portal-destination-network-validator.adapter'
import {
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
} from './application/use-cases/manage-portal-experience'
import {
  approvePortalApprovedDestination,
  disablePortalApprovedDestination,
  listPortalApprovedDestinations,
  revalidatePortalApprovedDestinations,
  requestPortalApprovedDestination,
} from './application/use-cases/manage-portal-approved-destinations'

type PortalContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  propertyApi: PropertyPublicApi &
    PropertyGoogleReviewDestinationPublicApi &
    PropertyLifecyclePublicApi
  staffPublicApi: StaffPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  baseUrl: string
  idGen: () => string
  secureRandomBytes: (size: number) => Buffer
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

type ResolvePublishedAccessArtifactRequest = Omit<
  ResolvePublishedAccessArtifactInput,
  'tokenDigest'
> &
  Readonly<{ rawToken: string }>

type PublicPortalByTokenResult =
  | Readonly<{
      status: 'found'
      result: Extract<ResolvePublicPortalTokenOutcome, { status: 'found' }>['data']
    }>
  | Readonly<{ status: 'unavailable' }>

export const buildPortalContext = (deps: PortalContextDeps) => {
  const portalRepo = createPortalRepository(deps.db)
  const listCurrentPortalIds = createCurrentPortalIdReader(deps.db)
  const portalCommandStore = createAtomicPortalCommandStore(deps.db, deps.events)
  const portalUploadStore = createPortalUploadIssuanceStore(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db, deps.clock)
  const portalGroupRepo = createPortalGroupRepository(deps.db)
  const portalAccessArtifactRepo = createPortalAccessArtifactRepository(
    deps.db,
    portalGroupRepo,
  )
  const portalApprovedDestinationRepo = createPortalApprovedDestinationRepository(
    deps.db,
    deps.events,
  )
  const portalExperienceRepo = createPortalExperienceRepository(deps.db, deps.events)
  const aiReplyBrandProfileAuthority = createPortalAiReplyBrandProfileAuthority(deps.db)
  const portalHealthRepo = createPortalHealthRepository(deps.db)
  const portalHealthReconciliationStore = createPortalHealthReconciliationStore(
    deps.db,
    deps.events,
    { clock: deps.clock, idGen: deps.idGen },
  )
  const portalDestinationNetworkValidator = createPortalDestinationNetworkValidator({
    clock: deps.clock,
  })
  const portalTokenRepo = createPortalTokenRepository(deps.db)
  const portalPublicationRepo = createPortalPublicationRepository(deps.db)
  const portalScopeRepo = createPortalScopeRepository(deps.db)
  const portalResponsibleManagerRepo = createPortalResponsibleManagerRepository(deps.db)
  const portalTokenCodec = createPortalTokenCodec({
    secret: deps.tokenHashSecret,
    randomBytes: deps.secureRandomBytes,
  })
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
    logger: deps.logger,
  })
  const useCases = {
    revalidatePortalApprovedDestinations: revalidatePortalApprovedDestinations({
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      clock: deps.clock,
    }),
    listPortalApprovedDestinations: listPortalApprovedDestinations({
      portalRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    requestPortalApprovedDestination: requestPortalApprovedDestination({
      portalRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    approvePortalApprovedDestination: approvePortalApprovedDestination({
      portalRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    disablePortalApprovedDestination: disablePortalApprovedDestination({
      portalRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    getPropertyPortalExperience: getPropertyPortalExperience({
      experienceRepo: portalExperienceRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    savePropertyPortalBrandProfile: savePropertyPortalBrandProfile({
      experienceRepo: portalExperienceRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    savePropertyPortalBrandContent: savePropertyPortalBrandContent({
      experienceRepo: portalExperienceRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    savePortalLocalizedOverride: savePortalLocalizedOverride({
      experienceRepo: portalExperienceRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    resolvePortalManagementScope: portalScopeRepo.resolvePortal,
    resolvePortalGroupManagementScope: portalScopeRepo.resolveGroup,
    resolvePortalCategoryManagementScope: portalScopeRepo.resolveCategory,
    resolvePortalLinkManagementScope: portalScopeRepo.resolveLink,
    listPortalManagementPropertyIds: portalScopeRepo.listPortalPropertyIds,
    listPortalResponsibleManagers: listPortalResponsibleManagers({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityManagerFacts,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    updatePortalResponsibleManagers: updatePortalResponsibleManagers({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityManagerFacts,
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
      identityPublicApi: deps.identityManagerFacts,
      idGen: portalIdGen,
      clock: deps.clock,
    }),
    updatePortal: updatePortal({
      portalRepo,
      commandStore: portalCommandStore,
      publicationRepo: portalPublicationRepo,
      portalTokenRepo,
      propertyGoogleReviewDestinationApi: deps.propertyApi,
      propertyLifecycleApi: deps.propertyApi,
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
      commandStore: portalCommandStore,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLinkCategory: updateLinkCategory({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    deleteLinkCategory: deleteLinkCategory({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    reorderCategories: reorderCategories({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    createLink: createLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      idGen: linkIdGen,
      clock: deps.clock,
    }),
    updateLink: updateLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    deleteLink: deleteLink({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    reorderLinks: reorderLinks({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
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
      commandStore: portalCommandStore,
      idGen: portalGroupIdGen,
      clock: deps.clock,
    }),
    updatePortalGroup: updatePortalGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
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
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    removePortalFromGroup: removePortalFromGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    issuePortalToken: issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: portalTokenCodec,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      idGen: deps.idGen,
      baseUrl: deps.baseUrl,
      clock: deps.clock,
    }),
    rotatePortalToken: rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: portalTokenCodec,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      idGen: deps.idGen,
      clock: deps.clock,
      baseUrl: deps.baseUrl,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    revokePortalTokens: revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
  } as const

  // ── Public API — consumed by guest context and other cross-context callers ──

  const contactRequestManagerAuthorityFacts =
    getPortalContactRequestManagerAuthorityFacts({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityManagerFacts,
      staffPublicApi: deps.staffPublicApi,
    })

  const publicApi = {
    resolvePortalContext: (portalIdParam: PortalId) =>
      portalRepo.resolvePortalContext(portalIdParam),
    getPortalInfo: (orgId: OrganizationId, pid: PortalId) =>
      portalRepo
        .findById(orgId, pid)
        .then((p) =>
          p ? { id: p.id, name: p.name, publicationState: p.publicationState } : null,
        ),
    listPortalIdsByProperty: async (orgId: OrganizationId, pid: PropertyId) =>
      (await portalRepo.listByProperty(orgId, pid)).map((p) => p.id),
    listCurrentPortalIds: async (
      orgId: OrganizationId,
      propertyId: PropertyId,
      limit: number,
    ) => {
      return listCurrentPortalIds(orgId, propertyId, limit)
    },
    findPublicPortalByToken: async (
      rawToken: string,
      preference?: GuestLocalePreference,
    ): Promise<PublicPortalByTokenResult> => {
      const outcome = await resolvePublicPortalToken({
        tokenCodec: portalTokenCodec,
        portalPublicationRepo,
        portalHealthRepo,
        listApprovedSecondaryDestinationUris:
          portalApprovedDestinationRepo.listApprovedUris,
        isPropertyActive: deps.propertyApi.isPropertyActive,
        getGoogleReviewDestination: deps.propertyApi.getGoogleReviewDestination,
        decidePublic: decidePublicExecution,
        reportGoogleDestinationFailure: () =>
          deps.logger.warn(
            { errorCode: 'portal_google_destination_unavailable' },
            'Portal Google review destination unavailable — serving degraded gateway',
          ),
        reportApprovedDestinationFailure: (error) =>
          deps.logger.warn(
            { errorCode: 'portal_approved_destinations_unavailable', err: error },
            'Portal approved destinations unreadable — serving no secondary links',
          ),
        reportApprovedDestinationsDropped: (counts) =>
          deps.logger.warn(
            { errorCode: 'portal_approved_destinations_dropped', ...counts },
            'Portal published destinations are not approved — serving fewer links',
          ),
        clock: deps.clock,
      })(rawToken, preference)
      return outcome.status === 'found'
        ? { status: 'found', result: outcome.data }
        : { status: 'unavailable' }
    },
    resolvePublishedAccessArtifact: ({
      rawToken,
      ...input
    }: ResolvePublishedAccessArtifactRequest) => {
      const tokenDigest = portalTokenCodec.digest(rawToken)
      return tokenDigest
        ? portalAccessArtifactRepo.resolvePublished({ ...input, tokenDigest })
        : Promise.resolve(null)
    },
    getContactRequestManagerAuthorityFacts: contactRequestManagerAuthorityFacts,
    readCurrentAiReplyBrandProfile:
      aiReplyBrandProfileAuthority.readCurrentAiReplyBrandProfile,
    isCurrentAiReplyBrandProfile:
      aiReplyBrandProfileAuthority.isCurrentAiReplyBrandProfile,
    getResponsibleManagerUserIds: async (orgId: OrganizationId, pid: PortalId) => {
      const facts = await contactRequestManagerAuthorityFacts(orgId, pid)
      return facts?.responsibleManagerUserIds ?? []
    },
    findPortalHealthNotificationFacts: async (orgId: OrganizationId, pid: PortalId) => {
      const portal = await portalRepo.findById(orgId, pid)
      if (!portal) return null
      const health = await portalHealthRepo.getCurrent(orgId, portal.propertyId, pid)
      return health
        ? {
            propertyId: portal.propertyId,
            status: health.status,
            reason: health.reason,
            sourceVersion: health.sourceVersion,
          }
        : null
    },
  }

  const portalGroupPublicApi = {
    findGroupForPortal: async (orgId: OrganizationId, pid: PortalId, asOf?: Date) => {
      const group = await portalGroupRepo.findGroupForPortal(
        orgId,
        pid,
        asOf ?? deps.clock(),
      )
      if (!group) return null
      return { id: group.id, propertyId: group.propertyId, name: group.name }
    },
    getGroupPortalIds: (orgId: OrganizationId, groupId: PortalGroupId) =>
      portalGroupRepo.getGroupPortalIds(orgId, groupId),
    findGroupIdsByPortalIds: (
      orgId: OrganizationId,
      portalIds: ReadonlyArray<PortalId>,
    ) => portalGroupRepo.findGroupIdsByPortalIds(orgId, portalIds),
    portalGroupBelongsToProperty: async (
      orgId: OrganizationId,
      pid: PropertyId,
      groupId: PortalGroupId,
    ) => {
      const group = await portalGroupRepo.findById(orgId, groupId)
      return group?.propertyId === pid
    },
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    if (!deps.outboxRepo) {
      throw new Error('Portal upload outbox repository is unavailable')
    }
    registerPortalConsumers(consumerRegistry, {
      processIssuedPortalImage,
      receipts: deps.outboxRepo,
    })
    registerPortalHealthConsumers(consumerRegistry, portalHealthReconciliationStore)
  }

  return {
    publicApi: {
      portal: publicApi,
      portalGroup: portalGroupPublicApi,
      /** Request-facing Portal capabilities. This is intentionally namespaced
       * and contains only application functions, never repositories/storage. */
      management: Object.freeze(useCases),
    },
    worker: Object.freeze({
      registerOutboxConsumers,
      revalidateApprovedDestinations: useCases.revalidatePortalApprovedDestinations,
    }),
    /** ARC-03-T11: the named member-authority capability. Replaces the root's
     * Portal responsible-manager repository reach-through. */
    responsibility: createPortalResponsibilityRuntime(portalResponsibleManagerRepo),
    /** ARC-03-T11: Portal-owned issued-object capability. `storage` is the
     * shared asset port (Identity profile assets, Portal media); `uploadStore`
     * is the issuance ledger the derivative worker settles against. Replaces
     * the root's Portal upload-store and storage reach-throughs. */
    uploads: Object.freeze({
      storage,
      uploadStore: portalUploadStore,
    }),
    /** LIF-01: the Portal-owned Organization Export contributor. It stays out
     * of `publicApi` on purpose — Portal is a dark context, and an export
     * slice is lifecycle composition input, not a product capability any
     * request-facing surface may reach. */
    organizationExportContributor: createPortalOrganizationExportContributor(deps.db),
    /** LIF-01-T12/T13/T14: the Portal-owned Organization lifecycle
     * contributor. Like the export slice it stays out of `publicApi`: the
     * purge phase must remain unreachable by default, and it may only ever be
     * reached through an explicitly reviewed composition of the lifecycle
     * coordinator, never through a request-facing surface. Making Portals
     * unavailable is a stop, so wiring it here activates nothing. */
    organizationLifecycleContributor: createPortalOrganizationLifecycleContributor(
      deps.db,
    ),
  } as const
}
