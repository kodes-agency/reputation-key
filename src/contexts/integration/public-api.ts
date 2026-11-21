/**
 * Integration context — public API for external consumers (components, routes).
 *
 * Re-exports domain types that components need.
 * Per boundary rules: components may import this file but NOT `domain/`.
 */
export type { GoogleConnectionDto } from './connections/contracts'
export type { GoogleAuthUrlInput } from './connections/google-auth-url.contracts'

export type { GoogleReviewSyncContentAuthorizer } from './review-sync/google-review-sync-authorizer.server'
export type { GoogleReplyPublicationContentAuthorizer } from './review-sync/google-reply-publication-authorizer.server'

export {
  contentExpiryDelayMs,
  createGoogleImportContentLifecycle,
} from './imports/google-import-content-lifecycle.contracts'
export type { GoogleImportViewCompletion } from './imports/google-import-content-lifecycle.contracts'

export type { GoogleConnectionStatus } from './domain/types'

export type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleAccountReauthorizationRequired,
  IntegrationGoogleConnectionVisibilityChanged,
  GoogleReviewPushNotificationKind,
} from './domain/events'

export {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
} from './provider/contracts'
export type { GoogleProviderRouteKey } from './provider/contracts'

export {
  GBP_IMPORT_ITEM_STATUSES,
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  IMPORT_OUTCOME_CODES,
  IMPORT_PARENT_STATUSES,
  IMPORT_PROFILE_FIELDS,
} from './application/google-import-contract'
export type {
  GbpImportItemStatus,
  ImportAccountDto,
  ImportAccountPageDto,
  ImportCandidateDto,
  ImportCandidatePageDto,
  ImportOutcomeCode,
  ImportParentStatus,
  ImportProfileField,
  ImportProgressDto,
  ImportProgressItemDto,
  StartPropertyImportItemInput,
} from './application/google-import-contract'
