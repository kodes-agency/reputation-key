/**
 * Integration context — public API for external consumers (components, routes).
 *
 * Re-exports domain types that components need.
 * Per boundary rules: components may import from `application/` but NOT from `domain/`.
 */
export type { GoogleConnectionDto } from './dto/google-connection.dto'
export type { GoogleAuthUrlInput } from './dto/google-auth-url.dto'

export type { GoogleReviewSyncContentAuthorizer } from './google-review-sync-authorizer'
export type { GoogleReplyPublicationContentAuthorizer } from './google-reply-publication-authorizer'

export {
  contentExpiryDelayMs,
  createGoogleImportContentLifecycle,
} from './google-import-content-lifecycle'
export type { GoogleImportViewCompletion } from './google-import-content-lifecycle'

export type { GoogleConnectionStatus } from '../domain/types'

export type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleAccountReauthorizationRequired,
  IntegrationGoogleConnectionVisibilityChanged,
  GoogleReviewPushNotificationKind,
} from '../domain/events'

export {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
} from './google-provider-contract'
export type { GoogleProviderRouteKey } from './google-provider-contract'

export {
  GBP_IMPORT_ITEM_STATUSES,
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  IMPORT_OUTCOME_CODES,
  IMPORT_PARENT_STATUSES,
} from './google-import-v2-contract'
export type {
  GbpImportItemStatus,
  ImportAccountDto,
  ImportAccountPageDto,
  ImportCandidateDto,
  ImportCandidatePageDto,
  ImportOutcomeCode,
  ImportParentStatus,
  ImportProgressDto,
  ImportProgressItemDto,
  StartPropertyImportItemInput,
} from './google-import-v2-contract'
