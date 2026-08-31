/**
 * Integration context — public API for external consumers (components, routes).
 *
 * Re-exports domain types that components need.
 * Per boundary rules: components may import from `application/` but NOT from `domain/`.
 */
export type { GoogleConnectionDto } from './dto/google-connection.dto'
export type { GoogleAuthUrlInput } from './dto/google-auth-url.dto'

export {
  GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
  GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
  createGoogleReviewSyncAuthorizer,
} from './google-review-sync-authorizer'
export type {
  GoogleReviewSyncAuthorizationResult,
  GoogleReviewSyncAuthorizer,
  GoogleReviewSyncContentAuthorizationResult,
  GoogleReviewSyncContentAuthorizer,
  GoogleReviewSyncProviderAuthorization,
} from './google-review-sync-authorizer'
export {
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST,
  createGoogleReplyPublicationAuthorizer,
} from './google-reply-publication-authorizer'
export type {
  GoogleReplyPublicationIdentity,
  GoogleReplyPublicationContentAuthorizer,
  GoogleReplyPublicationContentAuthorizationResult,
  GoogleReplyPublicationAuthorizer,
  GoogleReplyPublicationAuthorizationResult,
} from './google-reply-publication-authorizer'

export {
  contentExpiryDelayMs,
  createGoogleImportContentLifecycle,
} from './google-import-content-lifecycle'
export type {
  GoogleImportClearReason,
  GoogleImportViewCompletion,
} from './google-import-content-lifecycle'

export type { GoogleConnectionStatus, GoogleConnectionVisibility } from '../domain/types'

export type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleAccountReauthorizationRequired,
  IntegrationGoogleConnectionVisibilityChanged,
  GoogleReviewPushNotificationKind,
} from '../domain/events'
export {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
} from '../domain/events'

export {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
} from './google-provider-contract'
export type {
  GbpAccount,
  GbpLocationCandidate,
  GoogleAccountManagementPort,
  GoogleBusinessInformationPort,
  GoogleDailyMetric,
  GooglePerformanceSourcePort,
  GooglePerformanceSourceReport,
  GoogleProviderCallAuthorization,
  GoogleProviderRouteKey,
  GoogleReplyPublicationProviderCallAuthorization,
  GoogleReviewSyncProviderCallAuthorization,
  ProviderPage,
} from './google-provider-contract'

export {
  GBP_IMPORT_ITEM_STATUSES,
  GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT,
  IMPORT_ITEM_USER_ACTIONS,
  IMPORT_OUTCOME_CODES,
  IMPORT_OUTCOME_PRESENTATION,
  IMPORT_PARENT_STATUSES,
  PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
  getImportOutcomePresentation,
} from './google-import-v2-contract'
export type {
  ConfirmedCreatePropertyProfileInput,
  ConfirmedRelinkProfileInput,
  GbpImportItemStatus,
  GooglePropertyImportItemJobId,
  ImportAccountDto,
  ImportAccountPageDto,
  ImportCandidateDto,
  ImportCandidateEligibility,
  ImportCandidatePageDto,
  ImportItemUserAction,
  ImportOutcomeCode,
  ImportOutcomePresentation,
  ImportParentStatus,
  ImportProgressDto,
  ImportProgressItemDto,
  ImportReducerClass,
  IntegrationPropertyImportRequestedV1,
  IntegrationPropertyImportRetentionReleasedV1,
  RelinkPropertyProfileDto,
  StartPropertyImportInput,
  StartPropertyImportItemInput,
} from './google-import-v2-contract'
