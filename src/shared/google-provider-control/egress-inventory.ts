import { GOOGLE_PROVIDER_ROUTE_KEYS, type GoogleProviderRouteKey } from './contracts'
import { GOOGLE_PROVIDER_PRODUCTION_ORIGINS } from './route-catalogue'

export type GoogleProviderRecoveryRule =
  | 'safe_read_repeat'
  | 'preserve_then_never_reexchange'
  | 'renewable_single_flight_generation_cas'
  | 'one_use_revoke_reconciliation'
  | 'desired_state_readback'
  | 'publication_observation'

export type GoogleProviderEgressInventoryEntry = Readonly<{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  origin: (typeof GOOGLE_PROVIDER_PRODUCTION_ORIGINS)[number]
  credential:
    | 'none'
    | 'access_token'
    | 'authorization_code_pkce_client_secret'
    | 'refresh_token_client_secret'
    | 'revoke_token'
  transport: 'authorized_gateway_mtls' | 'direct_fixed_trust_read'
  repositoryState:
    'gateway_wired' | 'gateway_wired_durable_recovery' | 'direct_fixed_trust_read'
  recovery: GoogleProviderRecoveryRule
  ownerModule: string
}>

const entry = <T extends GoogleProviderEgressInventoryEntry>(value: T): T =>
  Object.freeze(value)

/**
 * Executable, exhaustive egress authority. Adding a route to the frozen route
 * catalogue is a type error here and a test failure until its transport,
 * credential class, owner, and ambiguous-outcome rule are chosen explicitly.
 *
 * This is an inventory of production behavior, not every source-only local
 * simulator seam. The promoted gateway bundle is separately scanned to prove
 * that local-sandbox/control-relay code is absent.
 */
export const GOOGLE_PROVIDER_EGRESS_INVENTORY = Object.freeze({
  'account-management.accounts.list': entry({
    method: 'GET',
    origin: 'https://mybusinessaccountmanagement.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-account-management.adapter.ts',
  }),
  'business-information.locations.list': entry({
    method: 'GET',
    origin: 'https://mybusinessbusinessinformation.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-business-information.adapter.ts',
  }),
  'performance.fetch': entry({
    method: 'GET',
    origin: 'https://businessprofileperformance.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-performance.adapter.ts',
  }),
  'oauth.token.exchange': entry({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'authorization_code_pkce_client_secret',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired_durable_recovery',
    recovery: 'preserve_then_never_reexchange',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
  }),
  'oauth.token.refresh': entry({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'refresh_token_client_secret',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'renewable_single_flight_generation_cas',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
  }),
  'oauth.jwks': entry({
    method: 'GET',
    origin: 'https://www.googleapis.com',
    credential: 'none',
    transport: 'direct_fixed_trust_read',
    repositoryState: 'direct_fixed_trust_read',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
  }),
  'oauth.revoke': entry({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'revoke_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired_durable_recovery',
    recovery: 'one_use_revoke_reconciliation',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
  }),
  'notifications.get': entry({
    method: 'GET',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
  }),
  'notifications.subscribe': entry({
    method: 'PATCH',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'desired_state_readback',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
  }),
  'notifications.unsubscribe': entry({
    method: 'PATCH',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'desired_state_readback',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
  }),
  'reviews.list': entry({
    method: 'GET',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
  }),
  'reviews.get': entry({
    method: 'GET',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
  }),
  'reviews.reply': entry({
    method: 'PUT',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'publication_observation',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
  }),
} satisfies Readonly<Record<GoogleProviderRouteKey, GoogleProviderEgressInventoryEntry>>)

function assertWriteRecoveryRule(
  routeKey: GoogleProviderRouteKey,
  route: GoogleProviderEgressInventoryEntry,
): void {
  if (route.method !== 'GET' && route.recovery === 'safe_read_repeat') {
    throw new Error(`Google provider write cannot be blindly repeated: ${routeKey}`)
  }
}

function assertTransportState(
  routeKey: GoogleProviderRouteKey,
  route: GoogleProviderEgressInventoryEntry,
): void {
  if (
    (route.transport === 'direct_fixed_trust_read') !==
    (route.repositoryState === 'direct_fixed_trust_read')
  ) {
    throw new Error(`Google provider egress state is invalid: ${routeKey}`)
  }
}

export function assertGoogleProviderEgressInventory(): void {
  const actualKeys = Object.keys(GOOGLE_PROVIDER_EGRESS_INVENTORY).sort()
  const expectedKeys = [...GOOGLE_PROVIDER_ROUTE_KEYS].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Google provider egress route inventory is incomplete')
  }
  for (const routeKey of GOOGLE_PROVIDER_ROUTE_KEYS) {
    const route = GOOGLE_PROVIDER_EGRESS_INVENTORY[routeKey]
    if (!GOOGLE_PROVIDER_PRODUCTION_ORIGINS.includes(route.origin)) {
      throw new Error(`Google provider egress origin is not approved: ${routeKey}`)
    }
    if (!route.ownerModule.startsWith('src/contexts/integration/')) {
      throw new Error(`Google provider egress owner is outside Integration: ${routeKey}`)
    }
    if (route.transport === 'direct_fixed_trust_read') {
      if (
        routeKey !== 'oauth.jwks' ||
        route.method !== 'GET' ||
        route.credential !== 'none' ||
        route.recovery !== 'safe_read_repeat'
      ) {
        throw new Error(`Google provider direct egress exception is invalid: ${routeKey}`)
      }
    }
    assertTransportState(routeKey, route)
    assertWriteRecoveryRule(routeKey, route)
  }
}
