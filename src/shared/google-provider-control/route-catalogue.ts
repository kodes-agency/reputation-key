import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  type GoogleEndpointClass,
  type GoogleProviderRouteKey,
  type GoogleRequestClass,
} from './contracts'

export { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from './contracts'

const boundedRouteString = z.string().min(1).max(8_192)
const optionalPageTokenSchema = z.string().min(1).max(2_048).optional()
const routeDescriptorSchema = z.discriminatedUnion('routeKey', [
  z
    .object({
      routeKey: z.literal('account-management.accounts.list'),
      accessToken: boundedRouteString,
      pageToken: optionalPageTokenSchema,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('business-information.locations.list'),
      accessToken: boundedRouteString,
      accountId: z.string().min(1).max(255),
      pageToken: optionalPageTokenSchema,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('performance.fetch'),
      accessToken: boundedRouteString,
      locationId: z.string().min(1).max(255),
      startLocalDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
      endLocalDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('oauth.token.exchange'),
      code: boundedRouteString,
      clientId: boundedRouteString,
      clientSecret: boundedRouteString,
      redirectUri: boundedRouteString,
      codeVerifier: boundedRouteString,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('oauth.token.refresh'),
      refreshToken: boundedRouteString,
      clientId: boundedRouteString,
      clientSecret: boundedRouteString,
    })
    .strict(),
  z.object({ routeKey: z.literal('oauth.jwks') }).strict(),
  z
    .object({
      routeKey: z.literal('oauth.revoke'),
      token: boundedRouteString,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('reviews.list'),
      accessToken: boundedRouteString,
      locationName: z.string().min(1).max(1_024),
      pageToken: optionalPageTokenSchema,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('reviews.get'),
      accessToken: boundedRouteString,
      reviewName: z.string().min(1).max(1_024),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('reviews.reply'),
      accessToken: boundedRouteString,
      reviewName: z.string().min(1).max(1_024),
      comment: z.string().min(1).max(4_096),
    })
    .strict(),
])
export type GoogleProviderRouteDescriptor =
  | Readonly<{
      routeKey: 'account-management.accounts.list'
      accessToken: string
      pageToken?: string
    }>
  | Readonly<{
      routeKey: 'business-information.locations.list'
      accessToken: string
      accountId: string
      pageToken?: string
    }>
  | Readonly<{
      routeKey: 'performance.fetch'
      accessToken: string
      locationId: string
      startLocalDate: string
      endLocalDate: string
    }>
  | Readonly<{
      routeKey: 'oauth.token.exchange'
      code: string
      clientId: string
      clientSecret: string
      redirectUri: string
      codeVerifier: string
    }>
  | Readonly<{
      routeKey: 'oauth.token.refresh'
      refreshToken: string
      clientId: string
      clientSecret: string
    }>
  | Readonly<{ routeKey: 'oauth.jwks' }>
  | Readonly<{ routeKey: 'oauth.revoke'; token: string }>
  | Readonly<{
      routeKey: 'reviews.list'
      accessToken: string
      locationName: string
      pageToken?: string
    }>
  | Readonly<{
      routeKey: 'reviews.get'
      accessToken: string
      reviewName: string
    }>
  | Readonly<{
      routeKey: 'reviews.reply'
      accessToken: string
      reviewName: string
      comment: string
    }>

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
  method: 'GET' | 'POST' | 'PUT'
  url: string
  headers: Readonly<Record<string, string>>
  body: Uint8Array | null
  admission: GoogleProviderAdmissionMetadata
}>

export type GoogleProviderRoutePolicy = Readonly<{
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
  requestClass: 'reviews' as const,
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 5 * 1024 * 1024,
  quotaPolicyId: 'google-reviews-v1',
  inFlightPolicyId: 'google-reviews-v1',
})

export const GOOGLE_PROVIDER_ROUTE_POLICIES = Object.freeze({
  'account-management.accounts.list': Object.freeze({
    ...DISCOVERY_POLICY,
    endpointClass: 'account-management' as const,
  }),
  'business-information.locations.list': Object.freeze({
    ...DISCOVERY_POLICY,
    endpointClass: 'business-information' as const,
  }),
  'performance.fetch': Object.freeze({
    endpointClass: 'performance' as const,
    requestClass: 'performance' as const,
    maxRequestBytes: 0,
    maxResponseBytes: 5 * 1024 * 1024,
    quotaPolicyId: 'google-performance-read-v1',
    inFlightPolicyId: 'google-performance-read-v1',
  }),
  'oauth.token.exchange': Object.freeze({
    ...IDENTITY_POLICY,
    endpointClass: 'oauth-token' as const,
    maxResponseBytes: 64 * 1024,
  }),
  'oauth.token.refresh': Object.freeze({
    endpointClass: 'oauth-token' as const,
    requestClass: 'credential_refresh' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-credential-refresh-v1',
    inFlightPolicyId: 'google-credential-refresh-v1',
  }),
  'oauth.jwks': Object.freeze({
    ...IDENTITY_POLICY,
    endpointClass: 'oauth-jwks' as const,
    maxRequestBytes: 0,
  }),
  'oauth.revoke': Object.freeze({
    endpointClass: 'oauth-revoke' as const,
    requestClass: 'credential_cleanup' as const,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
    quotaPolicyId: 'google-credential-cleanup-v1',
    inFlightPolicyId: 'google-credential-cleanup-v1',
  }),
  'reviews.list': Object.freeze({
    ...REVIEWS_POLICY,
    endpointClass: 'reviews' as const,
    maxRequestBytes: 0,
  }),
  'reviews.get': Object.freeze({
    ...REVIEWS_POLICY,
    endpointClass: 'reviews' as const,
    maxRequestBytes: 0,
    maxResponseBytes: 64 * 1024,
  }),
  'reviews.reply': Object.freeze({
    ...REVIEWS_POLICY,
    endpointClass: 'reviews' as const,
    maxResponseBytes: 64 * 1024,
  }),
} satisfies Readonly<Record<GoogleProviderRouteKey, GoogleProviderRoutePolicy>>)

type CredentialBinder = (credential: string) => string

type CompiledParts = Readonly<{
  endpointClass: GoogleEndpointClass
  requestClass: GoogleRequestClass
  method: 'GET' | 'POST' | 'PUT'
  url: string
  headers: Readonly<Record<string, string>>
  body: Uint8Array | null
  credential: string | null
  maxRequestBytes: number
  maxResponseBytes: number
  quotaPolicyId: string
  inFlightPolicyId: string
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

function jsonBody(value: Readonly<Record<string, string>>): Uint8Array {
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

function compileParts(descriptor: GoogleProviderRouteDescriptor): CompiledParts {
  switch (descriptor.routeKey) {
    case 'account-management.accounts.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      return {
        endpointClass: 'account-management',
        requestClass: 'discovery',
        method: 'GET',
        url: queryUrl('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', [
          ['pageSize', '20'],
          ['pageToken', optionalPageToken(descriptor.pageToken)],
        ]),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
        maxRequestBytes: 0,
        maxResponseBytes: 5 * 1024 * 1024,
        quotaPolicyId: 'google-discovery-read-v1',
        inFlightPolicyId: 'google-discovery-read-v1',
      }
    }
    case 'business-information.locations.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      const accountId = requireBounded(descriptor.accountId, 255)
      return {
        endpointClass: 'business-information',
        requestClass: 'discovery',
        method: 'GET',
        url: queryUrl(
          `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(accountId)}/locations`,
          [
            ['pageSize', '100'],
            ['readMask', 'name,title,storefrontAddress,categories,metadata'],
            ['pageToken', optionalPageToken(descriptor.pageToken)],
          ],
        ),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
        maxRequestBytes: 0,
        maxResponseBytes: 5 * 1024 * 1024,
        quotaPolicyId: 'google-discovery-read-v1',
        inFlightPolicyId: 'google-discovery-read-v1',
      }
    }
    case 'performance.fetch': {
      const accessToken = requireBounded(descriptor.accessToken)
      const locationId = requireBounded(descriptor.locationId, 255)
      const start = parseLocalDate(descriptor.startLocalDate)
      const end = parseLocalDate(descriptor.endLocalDate)
      if (descriptor.startLocalDate > descriptor.endLocalDate) return invalidInput()
      return {
        endpointClass: 'performance',
        requestClass: 'performance',
        method: 'GET',
        url: queryUrl(
          `https://businessprofileperformance.googleapis.com/v1/locations/${encodeURIComponent(locationId)}:fetchMultiDailyMetricsTimeSeries`,
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
        maxRequestBytes: 0,
        maxResponseBytes: 5 * 1024 * 1024,
        quotaPolicyId: 'google-performance-read-v1',
        inFlightPolicyId: 'google-performance-read-v1',
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
        endpointClass: 'oauth-token',
        requestClass: 'identity',
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: code,
        maxRequestBytes: MAX_FORM_BYTES,
        maxResponseBytes: MAX_FORM_BYTES,
        quotaPolicyId: 'google-identity-v1',
        inFlightPolicyId: 'google-identity-v1',
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
        endpointClass: 'oauth-token',
        requestClass: 'credential_refresh',
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: refreshToken,
        maxRequestBytes: MAX_FORM_BYTES,
        maxResponseBytes: MAX_FORM_BYTES,
        quotaPolicyId: 'google-credential-refresh-v1',
        inFlightPolicyId: 'google-credential-refresh-v1',
      }
    }
    case 'oauth.jwks':
      return {
        endpointClass: 'oauth-jwks',
        requestClass: 'identity',
        method: 'GET',
        url: 'https://www.googleapis.com/oauth2/v3/certs',
        headers: Object.freeze({}),
        body: null,
        credential: null,
        maxRequestBytes: 0,
        maxResponseBytes: 1024 * 1024,
        quotaPolicyId: 'google-identity-v1',
        inFlightPolicyId: 'google-identity-v1',
      }
    case 'oauth.revoke': {
      const token = requireBounded(descriptor.token)
      const body = formBody([['token', token]])
      return {
        endpointClass: 'oauth-revoke',
        requestClass: 'credential_cleanup',
        method: 'POST',
        url: 'https://oauth2.googleapis.com/revoke',
        headers: Object.freeze({ 'content-type': CONTENT_TYPE_FORM }),
        body,
        credential: token,
        maxRequestBytes: MAX_FORM_BYTES,
        maxResponseBytes: MAX_FORM_BYTES,
        quotaPolicyId: 'google-credential-cleanup-v1',
        inFlightPolicyId: 'google-credential-cleanup-v1',
      }
    }
    case 'reviews.list': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_RESOURCE_NAME.test(descriptor.locationName)) return invalidInput()
      return {
        endpointClass: 'reviews',
        requestClass: 'reviews',
        method: 'GET',
        url: queryUrl(
          `https://mybusiness.googleapis.com/v4/${descriptor.locationName}/reviews`,
          [
            ['pageSize', '50'],
            ['pageToken', optionalPageToken(descriptor.pageToken)],
          ],
        ),
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
        maxRequestBytes: 0,
        maxResponseBytes: 5 * 1024 * 1024,
        quotaPolicyId: 'google-reviews-v1',
        inFlightPolicyId: 'google-reviews-v1',
      }
    }
    case 'reviews.get': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_REVIEW_NAME.test(descriptor.reviewName)) return invalidInput()
      return {
        endpointClass: 'reviews',
        requestClass: 'reviews',
        method: 'GET',
        url: `https://mybusiness.googleapis.com/v4/${descriptor.reviewName}`,
        headers: bearerHeaders(accessToken),
        body: null,
        credential: accessToken,
        maxRequestBytes: 0,
        maxResponseBytes: 64 * 1024,
        quotaPolicyId: 'google-reviews-v1',
        inFlightPolicyId: 'google-reviews-v1',
      }
    }
    case 'reviews.reply': {
      const accessToken = requireBounded(descriptor.accessToken)
      if (!PROVIDER_REVIEW_NAME.test(descriptor.reviewName)) return invalidInput()
      const body = jsonBody({ comment: requireBounded(descriptor.comment, 4_096) })
      return {
        endpointClass: 'reviews',
        requestClass: 'reviews',
        method: 'PUT',
        url: `https://mybusiness.googleapis.com/v4/${descriptor.reviewName}/reply`,
        headers: Object.freeze({
          ...bearerHeaders(accessToken),
          'content-type': CONTENT_TYPE_JSON,
        }),
        body,
        credential: accessToken,
        maxRequestBytes: MAX_REVIEW_BODY_BYTES,
        maxResponseBytes: MAX_FORM_BYTES,
        quotaPolicyId: 'google-reviews-v1',
        inFlightPolicyId: 'google-reviews-v1',
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
  const parts = compileParts(descriptor)
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
        parts.method,
        url,
        bodySha256,
        credentialBinding,
      ]),
    )
    .digest('hex')
  return Object.freeze({
    routeKey: descriptor.routeKey,
    catalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    method: parts.method,
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
