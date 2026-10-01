// Portal context — build function.
// Wires portal repos, storage, and all portal use cases.
// Per ADR-0001: the composition root calls this and passes publicApis from upstream contexts.

import { createHash } from 'node:crypto'
import type { ConsumerRegistry } from '#/shared/outbox'
import type {
  PropertyFactsPublicApi,
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type { Database } from '#/shared/db'
import {
  createCurrentPortalIdReader,
  createPortalRepository,
} from './infrastructure/repositories/portal.repository'
import { createPortalResponsibilityRuntime } from './application/portal-responsibility-runtime'
import { createPortalLinkRepository } from './infrastructure/repositories/portal-link.repository'
import { createPortalGroupPublicApi } from './infrastructure/portal-group-public-api'
import { createPortalGroupRepository } from './infrastructure/repositories/portal-group.repository'
import { createPortalGroupHistoryRepository } from './infrastructure/repositories/portal-group-history.repository'
import { createS3StorageAdapter } from './infrastructure/adapters/s3-storage.adapter'
import { createSharpImageProcessor } from './infrastructure/adapters/sharp-image-processor.adapter'
import { createPortalMediaAssetRepository } from './infrastructure/repositories/portal-media-asset.repository'
import { createPortalTokenRepository } from './infrastructure/repositories/portal-token.repository'
import { createPortalPublicationRepository } from './infrastructure/repositories/portal-publication.repository'
import { buildPortalMaintenance } from './build-maintenance'
import { createPortalScopeRepository } from './infrastructure/repositories/portal-scope.repository'
import {
  createPortalResponsibilityRecoveryStore,
  createPortalResponsibleManagerRepository,
} from './infrastructure/repositories/portal-responsible-manager.repository'
import { registerPortalPropertyLifecycleConsumers } from './infrastructure/property-lifecycle-outbox-consumers'
import {
  createPortalAccessArtifactRepository,
  type ResolvePublishedAccessArtifactInput,
} from './infrastructure/repositories/portal-access-artifact.repository'
import { createPortalApprovedDestinationRepository } from './infrastructure/repositories/portal-approved-destination.repository'
import { createPortalExperienceRepository } from './infrastructure/repositories/portal-experience.repository'
import { createPortalHealthRepository } from './infrastructure/repositories/portal-health.repository'
import { createPortalHistoryRepository } from './infrastructure/repositories/portal-history.repository'
import { createPortalActorDirectoryAdapter } from './infrastructure/adapters/portal-actor-directory.adapter'
import { createPortalAiReplyBrandProfileAuthority } from './infrastructure/ai-reply-brand-profile-authority'
import type { StoragePort } from './application/ports/storage.port'
import type { ImageProcessorPort } from './application/ports/image-processor.port'
import { ingestPortalImage } from './application/use-cases/ingest-portal-image'
import { resolvePortalMediaUrls } from './application/use-cases/resolve-portal-media-urls'
import { servePortalMedia } from './application/use-cases/serve-portal-media'
import { sweepPortalMedia } from './application/use-cases/sweep-portal-media'
import { takeDownPortalMedia } from './application/use-cases/take-down-portal-media'
import { createPortalTokenCodec } from './infrastructure/adapters/portal-token-codec'
import { createPortalAddressCipher } from './infrastructure/adapters/portal-address-cipher'
import { createPortalAddressRepository } from './infrastructure/repositories/portal-address.repository'
import { createPortal } from './application/use-cases/create-portal'
import { getPortalCreationOptions } from './application/use-cases/get-portal-creation-options'
import { updatePortal } from './application/use-cases/update-portal'
import { buildExperienceUseCases } from './build-experience'
import { rollbackPortalPublication } from './application/use-cases/rollback-portal-publication'
import {
  publishPortalChanges,
  publishPortalsChanges,
} from './application/use-cases/publish-portal-changes'
import { getPortal } from './application/use-cases/get-portal'
import { buildPortalHistoryReads } from './build-history-reads'
import { listPortals } from './application/use-cases/list-portals'
import { listPortalOverview } from './application/use-cases/list-portal-overview'
import { softDeletePortal } from './application/use-cases/soft-delete-portal'
import { createLinkCategory } from './application/use-cases/create-link-category'
import { updateLinkCategory } from './application/use-cases/update-link-category'
import { deleteLinkCategory } from './application/use-cases/delete-link-category'
import { reorderCategories } from './application/use-cases/reorder-categories'
import { createLink } from './application/use-cases/create-link'
import { updateLink } from './application/use-cases/update-link'
import { savePortalLinkTexts } from './application/use-cases/save-portal-link-texts'
import { saveLinktreeSettings } from './application/use-cases/save-linktree-settings'
import { deleteLink } from './application/use-cases/delete-link'
import { reorderLinks } from './application/use-cases/reorder-links'
import { listPortalLinks } from './application/use-cases/list-portal-links'
import { getPortalLanguageCoverage } from './application/use-cases/get-portal-language-coverage'
import { getPortalLinktree } from './application/use-cases/get-portal-linktree'
import { getPortalPreview } from './application/use-cases/get-portal-preview'
import { createPortalGroup } from './application/use-cases/create-portal-group'
import { updatePortalGroup } from './application/use-cases/update-portal-group'
import { listPortalGroups } from './application/use-cases/list-portal-groups'
import { getPortalGroup } from './application/use-cases/get-portal-group'
import { softDeletePortalGroup } from './application/use-cases/soft-delete-portal-group'
import { addPortalToGroup } from './application/use-cases/add-portal-to-group'
import { removePortalFromGroup } from './application/use-cases/remove-portal-from-group'
import { movePortalToGroup } from './application/use-cases/move-portal-to-group'
import { listPortalGroupHistory } from './application/use-cases/list-portal-group-history'
import { issuePortalToken } from './application/use-cases/issue-portal-token'
import { rotatePortalToken } from './application/use-cases/rotate-portal-token'
import { revokePortalTokens } from './application/use-cases/revoke-portal-tokens'
import { revealPortalAddress } from './application/use-cases/reveal-portal-address'
import { buildPortalPrintKit } from './build-print-kit'
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
import { decidePublicExecution } from '#/shared/auth/execution-policy'
import {
  portalGroupId,
  portalId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { registerPortalHealthConsumers } from './infrastructure/portal-health-outbox-consumers'
import { createPortalHealthReconciliationStore } from './infrastructure/portal-health-reconciliation-store'
import { createPortalDestinationNetworkValidator } from './infrastructure/adapters/portal-destination-network-validator.adapter'
import { ensureDefaultPublicDisplayName } from './application/use-cases/manage-portal-experience'
import {
  approvePortalApprovedDestination,
  disablePortalApprovedDestination,
  listPortalApprovedDestinations,
  revalidatePortalApprovedDestinations,
  requestPortalApprovedDestination,
} from './application/use-cases/manage-portal-approved-destinations'

type PortalContextDeps = Readonly<{
  db: Database
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  propertyApi: PropertyPublicApi &
    PropertyGoogleReviewDestinationPublicApi &
    PropertyLifecyclePublicApi &
    Pick<PropertyFactsPublicApi, 'getPropertyTimezone'>
  staffPublicApi: StaffPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  baseUrl: string
  idGen: () => string
  secureRandomBytes: (size: number) => Buffer
  tokenHashSecret: string
  /**
   * The versioned keyring that seals each code's address (ADR 0064). Absent,
   * the address is shown once, when a code is made. A malformed keyring fails
   * the build, so a boot never runs with a keyring it cannot use.
   */
  addressEncryptionKeys?: string
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
  storage?: StoragePort
  /** Optional image processor override (tests inject a fake decoder); absent = sharp. */
  imageProcessor?: ImageProcessorPort
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
  const portalCommandStore = createAtomicPortalCommandStore(deps.db)
  const portalLinkRepo = createPortalLinkRepository(deps.db, deps.clock)
  const portalGroupRepo = createPortalGroupRepository(deps.db)
  const portalGroupHistoryRepo = createPortalGroupHistoryRepository(deps.db)
  const portalHistoryRepo = createPortalHistoryRepository(deps.db, deps.logger)
  const portalActorDirectory = createPortalActorDirectoryAdapter(deps.db)
  const portalAccessArtifactRepo = createPortalAccessArtifactRepository(
    deps.db,
    portalGroupRepo,
  )
  const portalApprovedDestinationRepo = createPortalApprovedDestinationRepository(deps.db)
  const portalExperienceRepo = createPortalExperienceRepository(deps.db)
  const aiReplyBrandProfileAuthority = createPortalAiReplyBrandProfileAuthority(deps.db)
  const portalHealthRepo = createPortalHealthRepository(deps.db)
  const portalHealthReconciliationStore = createPortalHealthReconciliationStore(deps.db, {
    clock: deps.clock,
    idGen: deps.idGen,
  })
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
  const portalAddressCipher = deps.addressEncryptionKeys
    ? createPortalAddressCipher({
        keyring: deps.addressEncryptionKeys,
        generateIv: () => deps.secureRandomBytes(12),
      })
    : null
  const portalAddressRepo = createPortalAddressRepository(deps.db)
  const portalWorkflowFactStore = createPortalWorkflowFactStore(deps.db)
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
  const portalMediaAssetRepo = createPortalMediaAssetRepository(deps.db)
  const imageProcessor = deps.imageProcessor ?? createSharpImageProcessor()
  const portalIdGen = () => portalId(deps.idGen())
  const portalGroupIdGen = () => portalGroupId(deps.idGen())
  const linkIdGen = () => deps.idGen()
  const publishChangesDeps = {
    portalRepo,
    commandStore: portalCommandStore,
    publicationRepo: portalPublicationRepo,
    portalTokenRepo,
    propertyGoogleReviewDestinationApi: deps.propertyApi,
    propertyLifecycleApi: deps.propertyApi,
    staffPublicApi: deps.staffPublicApi,
    idGen: deps.idGen,
    clock: deps.clock,
  }
  const revealAddress = revealPortalAddress({
    portalRepo,
    staffPublicApi: deps.staffPublicApi,
    portalAddressRepo,
    addressCipher: portalAddressCipher,
    clock: deps.clock,
    baseUrl: deps.baseUrl,
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
    ...buildExperienceUseCases({
      experienceRepo: portalExperienceRepo,
      mediaRepo: portalMediaAssetRepo,
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
      portalGroupRepo,
      portalLinkRepo,
      destinationRepo: portalApprovedDestinationRepo,
      experienceRepo: portalExperienceRepo,
      commandStore: portalCommandStore,
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      identityPublicApi: deps.identityManagerFacts,
      idGen: portalIdGen,
      entityIdGen: deps.idGen,
      clock: deps.clock,
    }),
    getPortalCreationOptions: getPortalCreationOptions({
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      identityPublicApi: deps.identityManagerFacts,
      experienceRepo: portalExperienceRepo,
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
    publishPortalChanges: publishPortalChanges(publishChangesDeps),
    publishPortalsChanges: publishPortalsChanges(publishChangesDeps),
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
      addressCipher: portalAddressCipher,
      clock: deps.clock,
    }),
    ...buildPortalHistoryReads({
      portalRepo,
      portalLinkRepo,
      experienceRepo: portalExperienceRepo,
      publicationRepo: portalPublicationRepo,
      historyRepo: portalHistoryRepo,
      healthRepo: portalHealthRepo,
      actorDirectory: portalActorDirectory,
      portalTokenRepo,
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    listPortals: listPortals({ portalRepo, staffPublicApi: deps.staffPublicApi }),
    listPortalOverview: listPortalOverview({
      portalRepo,
      portalHealthRepo,
      publicationRepo: portalPublicationRepo,
      portalGroupRepo,
      managerRepo: portalResponsibleManagerRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      addressCipher: portalAddressCipher,
      clock: deps.clock,
    }),
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
      mediaRepo: portalMediaAssetRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    savePortalLinkTexts: savePortalLinkTexts({
      portalRepo,
      portalLinkRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    ingestPortalImage: ingestPortalImage({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      propertyApi: deps.propertyApi,
      mediaRepo: portalMediaAssetRepo,
      objectStore: storage,
      imageProcessor,
      sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
      idGen: deps.idGen,
      clock: deps.clock,
      logger: deps.logger,
    }),
    takeDownPortalMedia: takeDownPortalMedia({
      mediaRepo: portalMediaAssetRepo,
      objectStore: storage,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
      logger: deps.logger,
    }),
    saveLinktreeSettings: saveLinktreeSettings({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
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
    getPortalLinktree: getPortalLinktree({
      portalRepo,
      portalLinkRepo,
      experienceRepo: portalExperienceRepo,
      destinationRepo: portalApprovedDestinationRepo,
      mediaRepo: portalMediaAssetRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    listPortalLinks: listPortalLinks({
      portalLinkRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    getPortalLanguageCoverage: getPortalLanguageCoverage({
      portalRepo,
      portalLinkRepo,
      experienceRepo: portalExperienceRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    getPortalPreview: getPortalPreview({
      portalRepo,
      portalLinkRepo,
      experienceRepo: portalExperienceRepo,
      destinationRepo: portalApprovedDestinationRepo,
      publicationRepo: portalPublicationRepo,
      mediaRepo: portalMediaAssetRepo,
      propertyFacts: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
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
    movePortalToGroup: movePortalToGroup({
      portalGroupRepo,
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    listPortalGroupHistory: listPortalGroupHistory({
      portalGroupRepo,
      portalGroupHistoryRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    issuePortalToken: issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: portalTokenCodec,
      addressCipher: portalAddressCipher,
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
      addressCipher: portalAddressCipher,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      idGen: deps.idGen,
      clock: deps.clock,
      baseUrl: deps.baseUrl,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    revealPortalAddress: revealAddress,
    ...buildPortalPrintKit({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: portalPublicationRepo,
      mediaRepo: portalMediaAssetRepo,
      objectStore: storage,
      revealAddress,
      clock: deps.clock,
    }),
    revokePortalTokens: revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
  } as const

  // The guest-facing image read. It is not part of `management`: it has no
  // session, and is served by the public media route only.
  const serveMedia = servePortalMedia({
    mediaRepo: portalMediaAssetRepo,
    objectStore: storage,
    sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    logger: deps.logger,
    decidePublic: decidePublicExecution,
    clock: deps.clock,
  })
  const mediaUrls = resolvePortalMediaUrls({ mediaRepo: portalMediaAssetRepo })

  // ── Public API — consumed by guest context and other cross-context callers ──

  const contactRequestManagerAuthorityFacts =
    getPortalContactRequestManagerAuthorityFacts({
      portalRepo,
      managerRepo: portalResponsibleManagerRepo,
      identityPublicApi: deps.identityManagerFacts,
      staffPublicApi: deps.staffPublicApi,
    })

  const publicApi = {
    servePortalMedia: serveMedia,
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
    listCurrentPortalIds: (
      orgId: OrganizationId,
      propertyId: PropertyId,
      limit: number,
    ) => listCurrentPortalIds(orgId, propertyId, limit),
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
        resolvePortalMediaUrls: mediaUrls,
        reportPortalMediaFailure: (error) =>
          deps.logger.warn(
            { errorCode: 'portal_media_unavailable', err: error },
            'Portal media lookup failed — serving the page without images',
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
    ensureDefaultPublicDisplayName: ensureDefaultPublicDisplayName({
      experienceRepo: portalExperienceRepo,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    listPublicationActivationsBetween: portalPublicationRepo.listActivationsBetween,
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
            effectiveFrom: health.effectiveFrom,
          }
        : null
    },
  }

  const portalGroupPublicApi = createPortalGroupPublicApi(portalGroupRepo, deps.clock)

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerPortalHealthConsumers(consumerRegistry, portalHealthReconciliationStore)
    registerPortalPropertyLifecycleConsumers(consumerRegistry, {
      recoveryStore: createPortalResponsibilityRecoveryStore(deps.db),
      clock: deps.clock,
    })
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
      sweepPortalMedia: sweepPortalMedia({
        mediaRepo: portalMediaAssetRepo,
        objectStore: storage,
        clock: deps.clock,
        logger: deps.logger,
      }),
    }),
    /** Operator-only Portal maintenance (round 4, slice 46); see build-maintenance.ts. */
    maintenance: buildPortalMaintenance(deps.db, publishChangesDeps, deps.logger),
    /** ARC-03-T11: the named member-authority capability. Replaces the root's
     * Portal responsible-manager repository reach-through. */
    responsibility: createPortalResponsibilityRuntime(portalResponsibleManagerRepo),
    /** ARC-03-T11: Portal-owned storage capability shared with live Identity
     * profile assets. The adapter remains private to composition. */
    uploads: Object.freeze({ storage }),
  } as const
}
