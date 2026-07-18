/**
 * Integration context — public API for external consumers (components, routes).
 *
 * Re-exports domain types that components need.
 * Per boundary rules: components may import from `application/` but NOT from `domain/`.
 */
export type { GoogleConnectionDto } from './dto/google-connection.dto'

export type { GoogleConnectionStatus, GoogleConnectionVisibility } from '../domain/types'

export type { GbpLocation } from '../domain/types'

export type { GbpImportJob, GbpImportJobStatus } from '../domain/types'
export type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleConnectionVisibilityChanged,
  IntegrationPropertyImportCompleted,
} from '../domain/events'
export {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
} from '../domain/events'
