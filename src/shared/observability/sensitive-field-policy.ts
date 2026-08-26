// One normalized field-name vocabulary for every observability boundary.
// Values are deliberately classified by their field name, never by scanning
// arbitrary value substrings. Logs, metrics/traces, and Sentry all consume
// isSensitiveObservabilityField so adding a protected spelling closes every
// egress surface together.

export const SENSITIVE_OBSERVABILITY_FIELD_NAMES = [
  'accessToken',
  'address',
  'apiKey',
  'authorization',
  'authorizationCode',
  'body',
  'businessName',
  'clientSecret',
  'codeVerifier',
  'comment',
  'contact',
  'cookie',
  'dsn',
  'email',
  'encryptedAccessToken',
  'encryptedRefreshToken',
  'feedbackText',
  'gbpLocationName',
  'handle',
  'headers',
  'idToken',
  'ipAddress',
  'key',
  'locationName',
  'noteText',
  'oauthState',
  'oauthStateHandle',
  'opaqueHandle',
  'pageToken',
  'password',
  'passwordHash',
  'phoneNumber',
  'privateFeedback',
  'providerBody',
  'providerResource',
  'query',
  'referer',
  'referrer',
  'refreshToken',
  'rejectionReason',
  'requestBody',
  'responseBody',
  'reviewerName',
  'reviewText',
  'revokeToken',
  'secret',
  'sessionCookie',
  'sessionId',
  'setCookie',
  'slug',
  'snippet',
  'state',
  'text',
  'token',
  'uri',
  'url',
  'userAgent',
  'verifier',
] as const

const SENSITIVE_SUFFIXES = [
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'codeverifier',
  'contact',
  'cookie',
  'dsn',
  'email',
  'handledigest',
  'idtoken',
  'pagetoken',
  'password',
  'providerurl',
  'refreshtoken',
  'secret',
  'sessioncookie',
  'sessionid',
  'statehandle',
  'token',
  'tokendigest',
  'uri',
  'url',
  'verifier',
] as const

export function normalizeObservabilityFieldName(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

const SENSITIVE_EXACT = new Set(
  SENSITIVE_OBSERVABILITY_FIELD_NAMES.map(normalizeObservabilityFieldName),
)

export function isSensitiveObservabilityField(key: string): boolean {
  const normalized = normalizeObservabilityFieldName(key)
  return (
    SENSITIVE_EXACT.has(normalized) ||
    SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  )
}
