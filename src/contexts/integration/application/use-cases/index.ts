// Integration context — use cases barrel export
// Per architecture: "Application layer exports a single index with all use cases."

export {
  connectGoogleAccount,
  type ConnectGoogleAccountDeps,
  type ConnectGoogleAccount,
  type ConnectGoogleAccountInput,
} from './connect-google-account'

export {
  disconnectGoogleAccount,
  type DisconnectGoogleAccountDeps,
  type DisconnectGoogleAccount,
  type DisconnectGoogleAccountInput,
} from './disconnect-google-account'

export {
  listGoogleConnections,
  type ListGoogleConnectionsDeps,
  type ListGoogleConnections,
} from './list-google-connections'

export {
  updateConnectionVisibility,
  type UpdateConnectionVisibilityDeps,
  type UpdateConnectionVisibility,
  type UpdateConnectionVisibilityInput,
} from './update-connection-visibility'

export {
  refreshGoogleToken,
  type RefreshGoogleTokenDeps,
  type RefreshGoogleToken,
  type RefreshGoogleTokenInput,
} from './refresh-google-token'

export {
  listGbpLocations,
  type ListGbpLocationsDeps,
  type ListGbpLocations,
  type ListGbpLocationsInput,
} from './list-gbp-locations'

export {
  startPropertyImport,
  type StartPropertyImportDeps,
  type StartPropertyImport,
  type StartPropertyImportInput,
} from './start-property-import'

export {
  getImportStatus,
  type GetImportStatusDeps,
  type GetImportStatus,
  type GetImportStatusInput,
} from './get-import-status'

export {
  handleGbpNotification,
  type HandleGbpNotificationDeps,
  type HandleGbpNotification,
  type HandleGbpNotificationInput,
  type HandleGbpNotificationResult,
} from './handle-gbp-notification'

export {
  importProperty,
  type ImportPropertyDeps,
  type ImportProperty,
  type ImportPropertyUseCase,
  type ImportPropertyInput,
  type ImportPropertyResult,
  type CreatedProperty,
} from './import-property'

export { type PropertyImportRepo } from '../ports/property-import-repo.port'
export {
  getGoogleAuthUrl,
  type GetGoogleAuthUrlDeps,
  type GetGoogleAuthUrl,
  type GetGoogleAuthUrlInput,
  type GetGoogleAuthUrlResult,
} from './get-google-auth-url'
