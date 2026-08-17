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
  type RefreshGoogleTokenOptions,
} from './refresh-google-token'

export {
  handleGbpNotification,
  type HandleGbpNotificationDeps,
  type HandleGbpNotification,
  type HandleGbpNotificationInput,
  type HandleGbpNotificationResult,
} from './handle-gbp-notification'

export {
  manageNotifications,
  type ManageNotificationsDeps,
  type ManageNotificationsApi,
} from './manage-notifications'
export {
  getGoogleAuthUrl,
  type GetGoogleAuthUrlDeps,
  type GetGoogleAuthUrl,
  type GetGoogleAuthUrlInput,
  type GetGoogleAuthUrlResult,
} from './get-google-auth-url'
