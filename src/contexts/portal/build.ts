import type { PortalRatingGoalReadApi } from '#/contexts/reporting/public-api'
import { buildPortalAddressOperations } from './build-address-operations'
import { assertPersonalGroupTargetAvailable } from './personal-portals/personal-portal-group-guard.server'
import { renamePersonalPortalLabels } from './personal-portals/rename-personal-portal-labels.server'
import { writePersonalPortalLabels } from './personal-portals/personal-portal-labels-writer.server'
import { buildPersonalPortalUseCases } from './build-personal-portals'
import { archivePersonalPortal } from './personal-portals/archive-personal-portal.server'
import { createPortalResultsLinksReader } from './links/portal-results-links-reader.server'

import { createHash } from 'node:crypto'
import type { ConsumerRegistry } from '#/shared/outbox'
import type {
  PropertyFactsPublicApi,
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
  PropertyPublicApi,
} from '#/contexts/property/public-api'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/public-api'
import type { Database } from '#/shared/db'
import { createPortalRepository } from './publication/portal-repository.server'
import { createPortalResponsibilityRuntime } from './responsibility/portal-responsibility-runtime.server'
import { createPortalLinkRepository } from './links/portal-link-repository.server'
import { createPortalGroupPublicApi } from './groups/portal-group-public-api.server'
import { createPortalGroupRepository } from './groups/portal-group-repository.server'
import { createPortalGroupHistoryRepository } from './groups/portal-group-history-repository.server'
import { createS3StorageAdapter } from './infrastructure/adapters/s3-storage.adapter'
import { createSharpImageProcessor } from './media/sharp-image-processor.adapter.server'
import { createPortalMediaAssetRepository } from './media/portal-media-asset-repository.server'
import { createPortalTokenRepository } from './addresses/portal-token-repository.server'
import { createPortalPublicationRepository } from './publication/portal-publication-repository.server'
import { createPortalScopeRepository } from './publication/portal-scope-repository.server'
import {
  createPortalResponsibilityRecoveryStore,
  createPortalResponsibleManagerRepository,
} from './responsibility/portal-responsible-manager-repository.server'
import { registerPortalPropertyLifecycleConsumers } from './responsibility/property-lifecycle-outbox-consumers.server'
import { registerPortalMemberOffboardingConsumers } from './responsibility/member-offboarding-outbox-consumers.server'
import { policyDeps as managerEligibilityPolicy } from './responsibility/portal-manager-eligibility.server'
import { releaseRemovedMemberResponsibilities } from '#/shared/responsible-manager/responsible-manager-eligibility'
import { createPortalAccessArtifactRepository } from './addresses/portal-access-artifact-repository.server'
import { createPortalApprovedDestinationRepository } from './destinations/portal-approved-destination-repository.server'
import { createPortalExperienceRepository } from './editor/portal-experience-repository.server'
import { createPortalLookRepository } from './look/portal-look-repository.server'
import { createPortalHealthRepository } from './health/portal-health-repository.server'
import { createPortalDestinationApprovalFactsReader } from './destinations/portal-destination-approval-facts-reader.server'
import { createPortalHistoryRepository } from './workspace/portal-history-repository.server'
import { createPortalActorDirectoryAdapter } from './workspace/portal-actor-directory.adapter.server'
import { createPortalAiReplyBrandProfileAuthority } from './look/ai-reply-brand-profile-authority.server'
import type { StoragePort } from './application/ports/storage.port'
import type { ImageProcessorPort } from './media/sharp-image-processor.port.server'
import { ingestPortalImage } from './media/ingest-portal-image.server'
import { buildPortalPublicMedia } from './build-public-media'
import { sweepPortalMedia } from './media/sweep-portal-media.server'
import { takeDownPortalMedia } from './media/take-down-portal-media.server'
import { createPortalTokenCodec } from './addresses/portal-token-codec.server'
import { createPortalAddressCipher } from './addresses/portal-address-cipher.server'
import { createPortalAddressRepository } from './addresses/portal-address-repository.server'
import { createPortalLastPrintRepository } from './printing/portal-last-print-repository.server'
import { createPortalPrintWordingRepository } from './printing/portal-print-wording-repository.server'
import { getPortalCreationOptions } from './publication/get-portal-creation-options.server'
import {
  archivePortal,
  changePortalLanguages,
  disablePortal,
  publishPortal,
  restorePortal,
  updatePortalSettings,
} from './publication/portal-intents.server'
import type { PortalIntentDeps } from './publication/portal-change.server'
import { buildExperienceUseCases } from './build-experience'
import { rollbackPortalPublication } from './publication/rollback-portal-publication.server'
import {
  publishPortalChanges,
  publishPortalsChanges,
} from './publication/publish-portal-changes.server'
import { getPortal } from './workspace/get-portal.server'
import { buildPortalHistoryReads } from './build-history-reads'
import { listPortals } from './workspace/list-portals.server'
import { listPortalOverview } from './workspace/list-portal-overview.server'
import { softDeletePortal } from './publication/soft-delete-portal.server'
import { createLink } from './links/create-link.server'
import { updateLink } from './links/update-link.server'
import { savePortalLinkTexts } from './links/save-portal-link-texts.server'
import { saveLinktreeSettings } from './links/save-linktree-settings.server'
import { deleteLink } from './links/delete-link.server'
import { reorderLinks } from './links/reorder-links.server'
import { listPortalLinks } from './links/list-portal-links.server'
import { getPortalLanguageCoverage } from './editor/get-portal-language-coverage.server'
import { getPortalLinktree } from './links/get-portal-linktree.server'
import { getPortalPreview } from './preview/get-portal-preview.server'
import { createPortalGroup } from './groups/create-portal-group.server'
import { updatePortalGroup } from './groups/update-portal-group.server'
import { listPortalGroups } from './groups/list-portal-groups.server'
import { softDeletePortalGroup } from './groups/soft-delete-portal-group.server'
import { removePortalFromGroup } from './groups/remove-portal-from-group.server'
import { movePortalToGroup } from './groups/move-portal-to-group.server'
import { listPortalGroupHistory } from './groups/list-portal-group-history.server'
import { revokePortalTokens } from './addresses/revoke-portal-tokens.server'
import type { PortalAddressFormat } from './addresses/portal-address-urls.server'
import { createPrintCodeReporter } from './addresses/print-code-reporter.server'
import { buildPortalPrintKit } from './build-print-kit'
import { createPropertyCountryReader } from './printing/print-kit-property-country.server'
import { resolvePublicPortalToken } from './publication/resolve-public-portal-token.server'
import type {
  PortalPublicApi,
  PortalContactRequestManagerAuthorityPublicApi,
  PortalAiReplyBrandProfilePublicApi,
  PortalPublicDisplayNameDefaultPublicApi,
} from './public-api'
import { completeContentReview } from './publication/complete-content-review.server'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './responsibility/portal-responsible-managers.server'
import { getPortalContactRequestManagerAuthorityFacts } from './publication/contact-request-authority.server'
import { createPortalRatingFacts } from './publication/portal-rating-facts.server'
import { createGoalReadinessFacts } from './publication/goal-readiness-facts.server'
import { createPortalWorkflowFactStore } from './publication/portal-workflow-fact-store.server'
import { createAtomicPortalCommandStore } from './publication/portal-command-store.server'
import { decidePublicExecution } from '#/shared/auth/execution-policy'
import {
  portalGroupId,
  portalId,
  type OrganizationId,
  type PortalId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { registerPortalHealthConsumers } from './health/portal-health-outbox-consumers.server'
import { createPortalHealthReconciliationStore } from './health/portal-health-reconciliation-store.server'
import { createPortalDestinationNetworkValidator } from './destinations/portal-destination-network-validator.adapter.server'
import { ensureDefaultPublicDisplayName } from './editor/manage-portal-experience.server'
import {
  approvePortalApprovedDestination,
  disablePortalApprovedDestination,
  listPortalApprovedDestinations,
  revalidatePortalApprovedDestinations,
  requestPortalApprovedDestination,
} from './destinations/manage-portal-approved-destinations.server'

type PortalContextDeps = Readonly<{
  db: Database
  /** Consumer receipts for the worker's outbox consumers. */
  outboxRepo: Pick<import('#/shared/outbox').OutboxRepository, 'insertReceipt'>
  clock: () => Date
  propertyApi: PropertyPublicApi &
    PropertyGoogleReviewDestinationPublicApi &
    PropertyLifecyclePublicApi &
    Pick<PropertyFactsPublicApi, 'getPropertyTimezone'>
  staffPublicApi: StaffPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  baseUrl: string
  /** The print host; absent, print codes use the app origin. */
  printCodes?: Readonly<{ printOrigin?: string }>
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
  ratingGoalGuard: PortalIntentDeps['ratingGoalGuard'] &
    Pick<PortalRatingGoalReadApi, 'findPortalRatingGoalBlockInTransaction'>
}>

export const buildPortalContext = (deps: PortalContextDeps) => {
  const portalRepo = createPortalRepository(deps.db)
  const portalCommandStore = createAtomicPortalCommandStore(deps.db, deps.ratingGoalGuard)
  const portalLinkRepo = createPortalLinkRepository(deps.db)
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
  const portalLookRepo = createPortalLookRepository(deps.db)
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
  const addressFormat: PortalAddressFormat = {
    appOrigin: deps.baseUrl,
    printOrigin: deps.printCodes?.printOrigin ?? new URL(deps.baseUrl).origin,
  }
  const reportPrintCodeProblem = createPrintCodeReporter(deps.logger)
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
  const publishChangesDeps = {
    ratingGoalGuard: deps.ratingGoalGuard,
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
  const { serveMedia, mediaUrls } = buildPortalPublicMedia(
    portalMediaAssetRepo,
    storage,
    { logger: deps.logger, clock: deps.clock, decidePublic: decidePublicExecution },
  )
  const addressOperations = buildPortalAddressOperations({
    publicationRepo: portalPublicationRepo,
    experienceRepo: portalExperienceRepo,
    mediaRepo: portalMediaAssetRepo,
    mediaUrls,
    wordingRepo: createPortalPrintWordingRepository(deps.db),
    lastPrintRepo: createPortalLastPrintRepository(deps.db),
    propertyLifecycleApi: deps.propertyApi,
    portalTokenRepo,
    commandStore: portalCommandStore,
    idGen: deps.idGen,
    portalRepo,
    staffPublicApi: deps.staffPublicApi,
    portalAddressRepo,
    addressCipher: portalAddressCipher,
    tokenCodec: portalTokenCodec,
    reportPrintCodeProblem,
    clock: deps.clock,
    address: addressFormat,
  })
  const revealAddress = addressOperations.revealPortalAddress
  const personalCreationDeps = {
    propertyLifecycleApi: deps.propertyApi,
    propertyGoogleReviewDestinationApi: deps.propertyApi,
    portalRepo,
    portalGroupRepo,
    portalLinkRepo,
    destinationRepo: portalApprovedDestinationRepo,
    experienceRepo: portalExperienceRepo,
    portalLookRepo,
    commandStore: portalCommandStore,
    propertyApi: deps.propertyApi,
    staffPublicApi: deps.staffPublicApi,
    identityPublicApi: deps.identityManagerFacts,
    idGen: portalIdGen,
    entityIdGen: deps.idGen,
    clock: deps.clock,
    checkGroupTarget: (scope: Parameters<typeof assertPersonalGroupTargetAvailable>[1]) =>
      assertPersonalGroupTargetAvailable(deps.db, scope),
    publicationRepo: portalPublicationRepo,
    addressRecoverable: portalAddressCipher !== null,
    managerRepo: portalResponsibleManagerRepo,
    printWordingRepo: createPortalPrintWordingRepository(deps.db),
    lastPrintRepo: createPortalLastPrintRepository(deps.db),
  }
  const commandDeps = {
    portalRepo,
    commandStore: portalCommandStore,
    staffPublicApi: deps.staffPublicApi,
    clock: deps.clock,
  }
  const destinationDeps = {
    portalRepo,
    destinationRepo: portalApprovedDestinationRepo,
    destinationNetworkValidator: portalDestinationNetworkValidator,
    staffPublicApi: deps.staffPublicApi,
    idGen: deps.idGen,
    clock: deps.clock,
  }
  const useCases = {
    renamePersonalPortalLabels: renamePersonalPortalLabels({
      write: writePersonalPortalLabels,
      clock: deps.clock,
    }),
    listPortalApprovedDestinations: listPortalApprovedDestinations(destinationDeps),
    requestPortalApprovedDestination: requestPortalApprovedDestination(destinationDeps),
    approvePortalApprovedDestination: approvePortalApprovedDestination(destinationDeps),
    disablePortalApprovedDestination: disablePortalApprovedDestination(destinationDeps),
    ...buildExperienceUseCases({
      experienceRepo: portalExperienceRepo,
      mediaRepo: portalMediaAssetRepo,
      portalRepo,
      portalLookRepo,
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
    ...buildPersonalPortalUseCases(personalCreationDeps, publishChangesDeps),
    archivePersonalPortal: archivePersonalPortal(publishChangesDeps),
    archivePersonalPortalForMemberDeparture: archivePersonalPortal(
      publishChangesDeps,
      true,
    ),
    getPortalCreationOptions: getPortalCreationOptions({
      propertyApi: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      identityPublicApi: deps.identityManagerFacts,
      experienceRepo: portalExperienceRepo,
    }),
    updatePortalSettings: updatePortalSettings(publishChangesDeps),
    changePortalLanguages: changePortalLanguages(publishChangesDeps),
    publishPortal: publishPortal(publishChangesDeps),
    disablePortal: disablePortal(publishChangesDeps),
    archivePortal: archivePortal(publishChangesDeps),
    restorePortal: restorePortal(publishChangesDeps),
    publishPortalChanges: publishPortalChanges(publishChangesDeps),
    publishPortalsChanges: publishPortalsChanges(publishChangesDeps),
    rollbackPortalPublication: rollbackPortalPublication({
      ...commandDeps,
      publicationRepo: portalPublicationRepo,
      idGen: deps.idGen,
    }),
    getPortal: getPortal({
      portalRepo,
      portalTokenRepo,
      staffPublicApi: deps.staffPublicApi,
      actorDirectory: portalActorDirectory,
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
      destinationRepo: portalApprovedDestinationRepo,
      mediaRepo: portalMediaAssetRepo,
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
      portalLookRepo,
      staffPublicApi: deps.staffPublicApi,
      addressCipher: portalAddressCipher,
      clock: deps.clock,
    }),
    softDeletePortal: softDeletePortal(commandDeps),
    createLink: createLink({
      ...commandDeps,
      portalLinkRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      idGen: () => deps.idGen(),
    }),
    updateLink: updateLink({
      ...commandDeps,
      portalLinkRepo,
      mediaRepo: portalMediaAssetRepo,
      destinationRepo: portalApprovedDestinationRepo,
      destinationNetworkValidator: portalDestinationNetworkValidator,
      idGen: deps.idGen,
    }),
    savePortalLinkTexts: savePortalLinkTexts({
      ...commandDeps,
      portalLinkRepo,
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
      ...commandDeps,
      idGen: deps.idGen,
    }),
    deleteLink: deleteLink({
      ...commandDeps,
      portalLinkRepo,
    }),
    reorderLinks: reorderLinks({
      ...commandDeps,
      portalLinkRepo,
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
      portalLookRepo,
      destinationRepo: portalApprovedDestinationRepo,
      publicationRepo: portalPublicationRepo,
      mediaRepo: portalMediaAssetRepo,
      propertyFacts: deps.propertyApi,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    createPortalGroup: createPortalGroup({
      ...commandDeps,
      portalGroupRepo,
      propertyApi: deps.propertyApi,
      idGen: portalGroupIdGen,
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
    softDeletePortalGroup: softDeletePortalGroup({
      portalGroupRepo,
      commandStore: portalCommandStore,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    removePortalFromGroup: removePortalFromGroup({
      portalGroupRepo,
      staffPublicApi: deps.staffPublicApi,
      commandStore: portalCommandStore,
      clock: deps.clock,
    }),
    movePortalToGroup: movePortalToGroup({
      ...commandDeps,
      portalGroupRepo,
    }),
    listPortalGroupHistory: listPortalGroupHistory({
      portalGroupRepo,
      portalGroupHistoryRepo,
      staffPublicApi: deps.staffPublicApi,
    }),
    ...addressOperations,
    ...buildPortalPrintKit({
      portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: portalPublicationRepo,
      mediaRepo: portalMediaAssetRepo,
      lastPrintRepo: createPortalLastPrintRepository(deps.db),
      wordingRepo: createPortalPrintWordingRepository(deps.db),
      objectStore: storage,
      revealAddress,
      propertyCountry: createPropertyCountryReader(deps.db),
      clock: deps.clock,
      logger: deps.logger,
    }),
    revokePortalTokens: revokePortalTokens({
      ...commandDeps,
      portalTokenRepo,
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

  const publicApi: PortalPublicApi &
    PortalContactRequestManagerAuthorityPublicApi &
    PortalAiReplyBrandProfilePublicApi &
    PortalPublicDisplayNameDefaultPublicApi & { servePortalMedia: typeof serveMedia } = {
    servePortalMedia: serveMedia,
    resolvePortalContext: (portalIdParam: PortalId) =>
      portalRepo.resolvePortalContext(portalIdParam),
    getPortalInfo: (orgId: OrganizationId, pid: PortalId) =>
      portalRepo.findById(orgId, pid).then((p) =>
        p
          ? {
              id: p.id,
              kind: p.kind,
              skipPrivateRating: p.skipPrivateRating,
              name: p.name,
              publicationState: p.publicationState,
            }
          : null,
      ),
    findPublicPortalByToken: async (rawToken: string, preference) => {
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
    isPrintCode: portalTokenCodec.isPrintCode,
    resolvePublishedAccessArtifact: ({ rawToken, ...input }) => {
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
    listResultsLinks: createPortalResultsLinksReader(deps.db),
    listPublicationActivationsBetween: portalPublicationRepo.listActivationsBetween,
    ...createPortalRatingFacts({ portalRepo, portalGroupRepo }),
    ...createGoalReadinessFacts({
      portalRepo,
      publicationRepo: portalPublicationRepo,
      portalTokenRepo,
      portalGroupRepo,
    }),
    getResponsibleManagerUserIds: async (orgId: OrganizationId, pid: PortalId) => {
      const facts = await contactRequestManagerAuthorityFacts(orgId, pid)
      return facts?.responsibleManagerUserIds ?? []
    },
    findDestinationApprovalNotificationFacts: createPortalDestinationApprovalFactsReader(
      deps.db,
    ),
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
    registerPortalMemberOffboardingConsumers(consumerRegistry, {
      // What a removed member still holds here: Portal responsibilities, each
      // judged by the Property its Portal belongs to.
      release: releaseRemovedMemberResponsibilities({
        eligibility: managerEligibilityPolicy({
          identityPublicApi: deps.identityManagerFacts,
          staffPublicApi: deps.staffPublicApi,
        }),
        listHeld: portalResponsibleManagerRepo.listActiveForUser,
        releaseHeld: (release, lost) =>
          portalResponsibleManagerRepo.releaseForUser({
            ...release,
            portalIds: lost.map((assignment) => assignment.portalId),
          }),
        clock: deps.clock,
      }),
      receipts: deps.outboxRepo,
    })
  }

  return {
    publicApi: {
      portal: publicApi,
      portalGroup: portalGroupPublicApi,
      /** Request-facing Portal capabilities, intentionally namespaced: functions
       * only, never a repository or storage object (exceptions: CONTEXT.md). */
      management: Object.freeze(useCases),
    },
    worker: Object.freeze({
      registerOutboxConsumers,
      revalidateApprovedDestinations: revalidatePortalApprovedDestinations({
        destinationRepo: portalApprovedDestinationRepo,
        destinationNetworkValidator: portalDestinationNetworkValidator,
        clock: deps.clock,
      }),
      sweepPortalMedia: sweepPortalMedia({
        mediaRepo: portalMediaAssetRepo,
        objectStore: storage,
        clock: deps.clock,
        logger: deps.logger,
      }),
    }),
    /** ARC-03-T11: the named member-authority capability. Replaces the root's
     * Portal responsible-manager repository reach-through. */
    responsibility: createPortalResponsibilityRuntime(portalResponsibleManagerRepo),
    /** ARC-03-T11: Portal-owned storage capability shared with live Identity
     * profile assets. The adapter remains private to composition. */
    uploads: Object.freeze({ storage }),
  } as const
}
