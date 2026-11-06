import { createHash } from 'node:crypto'
import {
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  type GoogleEndpointClass,
  type GoogleProviderRouteKey,
  type GoogleRequestClass,
} from './contracts'
import { replyCommentProblem } from './reply-comment'
import { REVIEW_LIST_NEWEST_UPDATED_FIRST } from './review-route-descriptors'
import {
  routeDescriptorSchema,
  type GoogleProviderRouteDescriptor,
} from './route-descriptors'

export type { GoogleProviderRouteDescriptor } from './route-descriptors'

export { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from './contracts'

export type GoogleProviderAdmissionMetadata = Readonly<{
  routeKey: GoogleProviderRouteKey
  catalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  endpointClass: GoogleEndpointClass
  requestClass: GoogleRequestClass
  requestBindingSha256: string
  credentialBinding: string
  requestBodySha256: string | null
  requestBodyBytes: number
  maxRequestBytes: number
  maxResponseBytes: number
  quotaPolicyId: string
  inFlightPolicyId: string
}>

export type CompiledGoogleProviderRequest = Readonly<{
  routeKey: GoogleProviderRouteKey
  catalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  url: string
  headers: Readonly<Record<string, string>>
  body: Uint8Array | null
  admission: GoogleProviderAdmissionMetadata
}>

export type GoogleProviderRecoveryRule =
  | 'safe_read_repeat'
  | 'preserve_then_never_reexchange'
  | 'renewable_single_flight_generation_cas'
  | 'one_use_revoke_reconciliation'
  | 'desired_state_readback'
  | 'publication_observation'

type GoogleProviderEgressPolicy = Readonly<{
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

export type GoogleProviderRoutePolicy = GoogleProviderEgressPolicy &
  Readonly<{
    endpointClass: GoogleEndpointClass
    requestClass: GoogleRequestClass
    maxRequestBytes: number
    maxResponseBytes: number
    quotaPolicyId: string
    inFlightPolicyId: string
  }>

const DISCOVERY_POLICY = Object.freeze({
  requestClass: 'discovery' as const,
  maxRequestBytes: 0,
  maxResponseBytes: 5 * 1024 * 1024,
  quotaPolicyId: 'google-discovery-read-v1',
  inFlightPolicyId: 'google-discovery-read-v1',
})
const IDENTITY_POLICY = Object.freeze({
  requestClass: 'identity' as const,
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 1024 * 1024,
  quotaPolicyId: 'google-identity-v1',
  inFlightPolicyId: 'google-identity-v1',
})
const REVIEWS_POLICY = Object.freeze({
  endpointClass: 'reviews' as const,
  requestClass: 'reviews' as const,
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 5 * 1024 * 1024,
  quotaPolicyId: 'google-reviews-v1',
  inFlightPolicyId: 'google-reviews-v1',
})

export const GOOGLE_PROVIDER_ROUTE_POLICIES = Object.freeze({
  'account-management.accounts.list': Object.freeze({
    method: 'GET',
    origin: 'https://mybusinessaccountmanagement.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-account-management.adapter.ts',
    ...DISCOVERY_POLICY,
    endpointClass: 'account-management' as const,
  }),
  'business-information.locations.list': Object.freeze({
    method: 'GET',
    origin: 'https://mybusinessbusinessinformation.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-business-information.adapter.ts',
    ...DISCOVERY_POLICY,
    endpointClass: 'business-information' as const,
  }),
  'performance.fetch': Object.freeze({
    method: 'GET',
    origin: 'https://businessprofileperformance.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-performance.adapter.ts',
    endpointClass: 'performance' as const,
    requestClass: 'performance' as const,
    maxRequestBytes: 0,
    maxResponseBytes: 5 * 1024 * 1024,
    quotaPolicyId: 'google-performance-read-v1',
    inFlightPolicyId: 'google-performance-read-v1',
  }),
  'oauth.token.exchange': Object.freeze({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'authorization_code_pkce_client_secret',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired_durable_recovery',
    recovery: 'preserve_then_never_reexchange',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
    ...IDENTITY_POLICY,
    endpointClass: 'oauth-token' as const,
    maxResponseBytes: 64 * 1024,
  }),
  'oauth.token.refresh': Object.freeze({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'refresh_token_client_secret',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'renewable_single_flight_generation_cas',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
    endpointClass: 'oauth-token' as const,
    requestClass: 'credential_refresh' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-credential-refresh-v1',
    inFlightPolicyId: 'google-credential-refresh-v1',
  }),
  'oauth.jwks': Object.freeze({
    method: 'GET',
    origin: 'https://www.googleapis.com',
    credential: 'none',
    transport: 'direct_fixed_trust_read',
    repositoryState: 'direct_fixed_trust_read',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
    ...IDENTITY_POLICY,
    endpointClass: 'oauth-jwks' as const,
    maxRequestBytes: 0,
  }),
  'oauth.revoke': Object.freeze({
    method: 'POST',
    origin: 'https://oauth2.googleapis.com',
    credential: 'revoke_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired_durable_recovery',
    recovery: 'one_use_revoke_reconciliation',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts',
    endpointClass: 'oauth-revoke' as const,
    requestClass: 'credential_cleanup' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-credential-cleanup-v1',
    inFlightPolicyId: 'google-credential-cleanup-v1',
  }),
  'notifications.get': Object.freeze({
    method: 'GET',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
    endpointClass: 'notifications' as const,
    requestClass: 'notifications' as const,
    maxRequestBytes: 0,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-notifications-read-v1',
    inFlightPolicyId: 'google-notifications-read-v1',
  }),
  'notifications.subscribe': Object.freeze({
    method: 'PATCH',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'desired_state_readback',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
    endpointClass: 'notifications' as const,
    requestClass: 'notifications' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-notifications-write-v1',
    inFlightPolicyId: 'google-notifications-write-v1',
  }),
  'notifications.unsubscribe': Object.freeze({
    method: 'PATCH',
    origin: 'https://mybusinessnotifications.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'desired_state_readback',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/mybusiness-notifications.adapter.ts',
    endpointClass: 'notifications' as const,
    requestClass: 'notifications' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-notifications-write-v1',
    inFlightPolicyId: 'google-notifications-write-v1',
  }),
  'reviews.list': Object.freeze({
    method: 'GET',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
    ...REVIEWS_POLICY,
    maxRequestBytes: 0,
  }),
  'reviews.get': Object.freeze({
    method: 'GET',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'safe_read_repeat',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
    ...REVIEWS_POLICY,
    maxRequestBytes: 0,
    maxResponseBytes: 64 * 1024,
  }),
  'reviews.reply': Object.freeze({
    method: 'PUT',
    origin: 'https://mybusiness.googleapis.com',
    credential: 'access_token',
    transport: 'authorized_gateway_mtls',
    repositoryState: 'gateway_wired',
    recovery: 'publication_observation',
    ownerModule:
      'src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts',
    ...REVIEWS_POLICY,
    maxResponseBytes: 64 * 1024,
    // Its own lane: see `google-reviews-write-v1` in quota-coordinator.ts.
    quotaPolicyId: 'google-reviews-write-v1',
    inFlightPolicyId: 'google-reviews-write-v1',
  }),
} satisfies Readonly<Record<GoogleProviderRouteKey, GoogleProviderRoutePolicy>>)

type CredentialBinder = (credential: string) => string

type CompiledParts = Readonly<{
  url: string
  headers: Readonly<Record<string, string>>
  body: Uint8Array | null
  credential: string | null
}>

const textEncoder = new TextEncoder()
const SHA256 = /^[a-f0-9]{64}$/
const PROVIDER_RESOURCE_NAME = /^accounts\/[^/]{1,255}\/locations\/[^/]{1,255}$/
const PROVIDER_REVIEW_NAME =
  /^accounts\/[^/]{1,255}\/locations\/[^/]{1,255}\/reviews\/[^/]{1,255}$/
const MAX_FIELD_BYTES = 8 * 1024
const MAX_FORM_BYTES = 64 * 1024
const MAX_REVIEW_BODY_BYTES = 64 * 1024
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded'
const CONTENT_TYPE_JSON = 'application/json'
const PROVIDER_ACCOUNT_ID = /^[A-Za-z0-9_-]{1,255}$/
const PUBSUB_TOPIC =
  /^projects\/[A-Za-z0-9._:-]{1,255}\/topics\/[A-Za-z0-9._~+%-]{1,255}$/
const NOTIFICATION_TYPES = new Set(['NEW_REVIEW', 'UPDATED_REVIEW'])

function invalidInput(): never {
  throw new Error('provider route input is invalid')
}

function requireBounded(value: string, maxBytes = MAX_FIELD_BYTES): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
    })
  ) {
    return invalidInput()
  }
  return value
}

function requireReplyComment(value: string): string {
  if (typeof value !== 'string' || replyCommentProblem(value) !== null) {
    return invalidInput()
  }
  return value
}

function optionalPageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return requireBounded(value, 2_048)
}

function parseLocalDate(value: string): Readonly<{
  year: number
  month: number
  day: number
}> {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return invalidInput()
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1) return invalidInput()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return invalidInput()
  return Object.freeze({ year, month, day })
}

function formBody(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const params = new URLSearchParams()
  for (const [name, value] of entries) params.append(name, requireBounded(value))
  const bytes = textEncoder.encode(params.toString())
  if (bytes.byteLength > MAX_FORM_BYTES) return invalidInput()
  return bytes
}

function jsonBody(value: unknown): Uint8Array {
  const bytes = textEncoder.encode(JSON.stringify(value))
  if (bytes.byteLength > MAX_REVIEW_BODY_BYTES) return invalidInput()
  return bytes
}

function bearerHeaders(accessToken: string): Readonly<Record<string, string>> {
  return Object.freeze({ authorization: `Bearer ${requireBounded(accessToken)}` })
}

function queryUrl(
  base: string,
  values: ReadonlyArray<readonly [string, string | undefined]>,
): string {
  const query = new URLSearchParams()
  for (const [name, value] of values) {
    if (value !== undefined) query.append(name, value)
  }
  const suffix = query.toString()
  return suffix.length === 0 ? base : `${base}?${suffix}`
}

function compileParts(
  descriptor: GoogleProviderRouteDescriptor,
  origin: string,
): CompiledParts {
  switch (descriptor.routeKey) {
    case 'account-management.accounts.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      return {
        url: queryUrl(`${origin}/v1/accounts`, [
          ['pageSize', '20'],
          ['pageToken', optionalPageToken(descriptor.pageToken)],
        ]),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'business-information.locations.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      const accountId = requireBounded(descriptor.accountId, 255)
      return {
        url: queryUrl(
          `${origin}/v1/accounts/${encodeURIComponent(accountId)}/locations`,
          [
            ['pageSize', '100'],
            ['readMask', 'name,title,storefrontAddress,categories,metadata'],
            ['pageToken', optionalPageToken(descriptor.pageToken)],
          ],
        ),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'performance.fetch': {
      const accessToken = requireBounded(descriptor.accessToken)
      const locationId = requireBounded(descriptor.locationId, 255)
      const start = parseLocalDate(descriptor.startLocalDate)
      const end = parseLocalDate(descriptor.endLocalDate)
      if (descriptor.startLocalDate > descriptor.endLocalDate) return invalidInput()
      return {
        url: queryUrl(
          `${origin}/v1/locations/${encodeURIComponent(locationId)}:fetchMultiDailyMetricsTimeSeries`,
          [
            ...GOOGLE_PERFORMANCE_DAILY_METRICS.map(
              (metric) => ['dailyMetrics', metric] as const,
            ),
            ['dailyRange.startDate.year', String(start.year)],
            ['dailyRange.startDate.month', String(start.month)],
            ['dailyRange.startDate.day', String(start.day)],
            ['dailyRange.endDate.year', String(end.year)],
            ['dailyRange.endDate.month', String(end.month)],
            ['dailyRange.endDate.day', String(end.day)],
            ['prettyPrint', 'false'],
          ],
        ),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'oauth.token.exchange': {
      const code = requireBounded(descriptor.code)
      const body = formBody([
        ['code', code],
        ['client_id', descriptor.clientId],
        ['client_secret', descriptor.clientSecret],
        ['redirect_uri', descriptor.redirectUri],
        ['grant_type', 'authorization_code'],
        ['code_verifier', descriptor.codeVerifier],
      ])
      return {
        url: `${origin}/token`,
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: code,
      }
    }
    case 'oauth.token.refresh': {
      const refreshToken = requireBounded(descriptor.refreshToken)
      const body = formBody([
        ['refresh_token', refreshToken],
        ['client_id', descriptor.clientId],
        ['client_secret', descriptor.clientSecret],
        ['grant_type', 'refresh_token'],
      ])
      return {
        url: `${origin}/token`,
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: refreshToken,
      }
    }
    case 'oauth.jwks':
      return {
        url: `${origin}/oauth2/v3/certs`,
        headers: Object.freeze({}),
        body: null,
        credential: null,
      }
    case 'oauth.revoke': {
      const token = requireBounded(descriptor.token)
      const body = formBody([['token', token]])
      return {
        url: `${origin}/revoke`,
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: token,
      }
    }
    case 'notifications.get': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_ACCOUNT_ID.test(descriptor.accountId)) return invalidInput()
      return {
        url: `${origin}/v1/accounts/${descriptor.accountId}/notificationSetting`,
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'notifications.subscribe': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (
        !PROVIDER_ACCOUNT_ID.test(descriptor.accountId) ||
        !PUBSUB_TOPIC.test(descriptor.pubsubTopic) ||
        descriptor.notificationTypes.length < 1 ||
        descriptor.notificationTypes.length > 2 ||
        new Set(descriptor.notificationTypes).size !==
          descriptor.notificationTypes.length ||
        descriptor.notificationTypes.some((type) => !NOTIFICATION_TYPES.has(type))
      ) {
        return invalidInput()
      }
      const body = jsonBody({
        name: `accounts/${descriptor.accountId}/notificationSetting`,
        pubsubTopic: descriptor.pubsubTopic,
        notificationTypes: [...descriptor.notificationTypes],
      })
      return {
        url: queryUrl(
          `${origin}/v1/accounts/${descriptor.accountId}/notificationSetting`,
          [['updateMask', 'pubsubTopic,notificationTypes']],
        ),
        headers: Object.freeze({
          ...bearerHeaders(accessToken),
          'content-type': CONTENT_TYPE_JSON,
        }),
        body,
        credential: accessToken,
      }
    }
    case 'notifications.unsubscribe': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_ACCOUNT_ID.test(descriptor.accountId)) return invalidInput()
      const body = jsonBody({
        name: `accounts/${descriptor.accountId}/notificationSetting`,
        pubsubTopic: '',
      })
      return {
        url: queryUrl(
          `${origin}/v1/accounts/${descriptor.accountId}/notificationSetting`,
          [['updateMask', 'pubsubTopic']],
        ),
        headers: Object.freeze({
          ...bearerHeaders(accessToken),
          'content-type': CONTENT_TYPE_JSON,
        }),
        body,
        credential: accessToken,
      }
    }
    case 'reviews.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_RESOURCE_NAME.test(descriptor.locationName)) return invalidInput()
      if (
        descriptor.orderBy !== undefined &&
        descriptor.orderBy !== REVIEW_LIST_NEWEST_UPDATED_FIRST
      ) {
        return invalidInput()
      }
      return {
        url: queryUrl(`${origin}/v4/${descriptor.locationName}/reviews`, [
          ['pageSize', '50'],
          ['pageToken', optionalPageToken(descriptor.pageToken)],
          ['orderBy', descriptor.orderBy],
        ]),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'reviews.get': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_REVIEW_NAME.test(descriptor.reviewName)) return invalidInput()
      return {
        url: `${origin}/v4/${descriptor.reviewName}`,
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
      }
    }
    case 'reviews.reply': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_REVIEW_NAME.test(descriptor.reviewName)) return invalidInput()
      // Not `requireBounded`: that rule is for header and URL fields and refuses
      // every C0 control, including the line feeds of a multi-paragraph reply
      // (incident b129e390). JSON.stringify escapes \n, \r and \t safely.
      const body = jsonBody({ comment: requireReplyComment(descriptor.comment) })
      return {
        url: `${origin}/v4/${descriptor.reviewName}/reply`,
        headers: Object.freeze({
          ...bearerHeaders(accessToken),
          'content-type': CONTENT_TYPE_JSON,
        }),
        body,
        credential: accessToken,
      }
    }
    default:
      throw new Error('provider route is unknown')
  }
}

export const GOOGLE_PROVIDER_PRODUCTION_ORIGINS = Object.freeze([
  'https://mybusinessaccountmanagement.googleapis.com',
  'https://mybusinessbusinessinformation.googleapis.com',
  'https://mybusiness.googleapis.com',
  'https://businessprofileperformance.googleapis.com',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com',
  'https://mybusinessnotifications.googleapis.com',
] as const)

export type GoogleProviderRouteTarget =
  | Readonly<{ kind: 'production' }>
  | Readonly<{ kind: 'local_sandbox'; simulatorOrigin: string }>

const PRODUCTION_ROUTE_TARGET: GoogleProviderRouteTarget = Object.freeze({
  kind: 'production',
})

function targetRouteUrl(providerUrl: string, target: GoogleProviderRouteTarget): string {
  const source = new URL(providerUrl)
  if (target.kind === 'production') {
    if (!GOOGLE_PROVIDER_PRODUCTION_ORIGINS.some((origin) => origin === source.origin)) {
      throw new Error('provider route origin is not approved')
    }
    return providerUrl
  }
  const simulator = new URL(target.simulatorOrigin)
  if (
    simulator.protocol !== 'https:' ||
    simulator.username ||
    simulator.password ||
    simulator.origin !== target.simulatorOrigin
  ) {
    throw new Error('provider simulator origin is invalid')
  }
  return `${simulator.origin}${source.pathname}${source.search}`
}

export function compileGoogleProviderRequest(
  descriptor: GoogleProviderRouteDescriptor,
  bindCredential: CredentialBinder,
  target: GoogleProviderRouteTarget = PRODUCTION_ROUTE_TARGET,
): CompiledGoogleProviderRequest {
  const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[descriptor.routeKey]
  if (!policy) throw new Error('provider route is unknown')
  const parts = compileParts(descriptor, policy.origin)
  const url = targetRouteUrl(parts.url, target)
  const bodySha256 =
    parts.body === null ? null : createHash('sha256').update(parts.body).digest('hex')
  const credentialBinding =
    parts.credential === null ? 'none' : bindCredential(parts.credential)
  if (credentialBinding !== 'none' && !SHA256.test(credentialBinding)) {
    throw new Error('provider credential binding is invalid')
  }
  const requestBindingSha256 = createHash('sha256')
    .update(
      JSON.stringify([
        descriptor.routeKey,
        policy.method,
        url,
        bodySha256,
        credentialBinding,
      ]),
    )
    .digest('hex')
  return Object.freeze({
    routeKey: descriptor.routeKey,
    catalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    method: policy.method,
    url,
    headers: parts.headers,
    body: parts.body,
    admission: Object.freeze({
      routeKey: descriptor.routeKey,
      catalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
      endpointClass: policy.endpointClass,
      requestClass: policy.requestClass,
      requestBindingSha256,
      credentialBinding,
      requestBodySha256: bodySha256,
      requestBodyBytes: parts.body?.byteLength ?? 0,
      maxRequestBytes: policy.maxRequestBytes,
      maxResponseBytes: policy.maxResponseBytes,
      quotaPolicyId: policy.quotaPolicyId,
      inFlightPolicyId: policy.inFlightPolicyId,
    }),
  })
}

export function parseGoogleProviderRouteDescriptor(
  value: unknown,
): GoogleProviderRouteDescriptor {
  const parsed = routeDescriptorSchema.safeParse(value)
  if (!parsed.success) throw new Error('provider route input is invalid')
  return parsed.data
}

function assertWriteRecoveryRule(
  routeKey: GoogleProviderRouteKey,
  route: GoogleProviderRoutePolicy,
): void {
  if (route.method !== 'GET' && route.recovery === 'safe_read_repeat') {
    throw new Error(`Google provider write cannot be blindly repeated: ${routeKey}`)
  }
}

function assertTransportState(
  routeKey: GoogleProviderRouteKey,
  route: GoogleProviderRoutePolicy,
): void {
  if (
    (route.transport === 'direct_fixed_trust_read') !==
    (route.repositoryState === 'direct_fixed_trust_read')
  ) {
    throw new Error(`Google provider egress state is invalid: ${routeKey}`)
  }
}

export function assertGoogleProviderRoutePolicies(): void {
  const actualKeys = Object.keys(GOOGLE_PROVIDER_ROUTE_POLICIES).sort()
  const expectedKeys = [...GOOGLE_PROVIDER_ROUTE_KEYS].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Google provider egress route inventory is incomplete')
  }
  for (const routeKey of GOOGLE_PROVIDER_ROUTE_KEYS) {
    const route = GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]
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
