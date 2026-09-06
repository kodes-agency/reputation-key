// Production fail-closed guards for Google provider configuration.
//
// Both guards exist because the same configuration mistake can otherwise
// produce a process that boots and then fails, silently or expensively, on
// every unit of real work:
//
//   1. REVIEW_PROVIDER_SUBJECT_HMAC_KEYS is `optional()` in the env schema but
//      MANDATORY at runtime for a worker: `acquireDeriver()` is the first thing
//      runReviewProviderSnapshot does, and without the keyring it throws
//      `config_invalid` — an opaque tagged error with no field name — for every
//      sync, three retries deep, into quarantine. In production with jobs
//      enabled the process must refuse to start instead, naming the variable.
//
//   2. Credential-bearing OAuth adapters retain deterministic direct
//      transports outside production. In production those sockets must refuse
//      without an environment escape hatch whenever the governed credential
//      executor is unavailable.
//
// Scope: NODE_ENV === 'production' only. Development, test and CI keep their
// deterministic local behaviour, so these guards gate on the environment,
// never on presence.

/** Env fields the credential-egress guard reports as missing, in report order. */
export const GOOGLE_EGRESS_CONFIG_FIELDS = [
  'GOOGLE_EGRESS_GATEWAY_ORIGIN',
  'GOOGLE_EGRESS_GATEWAY_SERVER_NAME',
  'GOOGLE_INTERNAL_MTLS_CA_B64',
  'GOOGLE_INTERNAL_MTLS_CERT_B64',
  'GOOGLE_INTERNAL_MTLS_KEY_B64',
  'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
] as const

/** Temporary expand/cutover compatibility for runtimes with mounted files. */
export const GOOGLE_EGRESS_LEGACY_PATH_FIELDS = [
  'GOOGLE_INTERNAL_MTLS_CA_PATH',
  'GOOGLE_INTERNAL_MTLS_CERT_PATH',
  'GOOGLE_INTERNAL_MTLS_KEY_PATH',
] as const

export type GoogleEgressConfigField = (typeof GOOGLE_EGRESS_CONFIG_FIELDS)[number]

export type DirectProviderEgressEnv = Readonly<
  { NODE_ENV?: string; GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS?: boolean } & Partial<
    Record<
      GoogleEgressConfigField | (typeof GOOGLE_EGRESS_LEGACY_PATH_FIELDS)[number],
      string
    >
  >
>

export type ReviewProviderSubjectKeysEnv = Readonly<{
  NODE_ENV?: string
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS?: string
}>

/**
 * Tagged configuration failure. Names FIELDS only — never values.
 *
 * ADR 0005 hybrid, per src/contexts/CONTEXT.md § Error pattern (BQR-1.2) and
 * the `domainError` / `integrationError` precedent: a real Error — so
 * `instanceof Error` holds, a stack is captured, and log serializers render it
 * instead of `[object Object]` — carrying the tagged shape as enumerable
 * properties. The convention is a factory plus an `isXxxError` guard, never a
 * class: catch sites discriminate on `_tag`, and a class made `_tag`/`code`
 * fields nothing actually read.
 */
export type ProviderConfigError = Readonly<{
  _tag: 'ProviderConfigError'
  code: 'config_invalid'
  message: string
  /** Env field names that are unset, in report order. */
  missing: readonly string[]
}>

const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

const providerConfigError = (
  message: string,
  missing: readonly string[],
): Error & ProviderConfigError => {
  // TS can't see defineProperties add props, so the intersection is asserted once here.
  const err = new Error(message) as Error & ProviderConfigError
  Object.defineProperties(err, {
    name: defineEnumerable('ProviderConfigError'),
    _tag: defineEnumerable('ProviderConfigError'),
    code: defineEnumerable('config_invalid'),
    missing: defineEnumerable(missing),
  })
  // Hide this factory's frame from the stack the boot failure reports.
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, providerConfigError)
  }
  return err
}

export const isProviderConfigError = (e: unknown): e is ProviderConfigError => {
  if (typeof e !== 'object' || e === null || !('_tag' in e)) return false
  return e._tag === 'ProviderConfigError'
}

/**
 * Refuse to boot a production process that will run review provider jobs
 * without the worker-only subject keyring. No-op outside production, and
 * no-op for a process that does not enable jobs (the web container must NOT
 * carry this material — composition rejects it there).
 */
export function assertReviewProviderSubjectKeysConfigured(
  env: ReviewProviderSubjectKeysEnv,
  jobsEnabled: boolean,
): void {
  if (env.NODE_ENV !== 'production' || !jobsEnabled) return
  if (env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS) return
  throw providerConfigError(
    '[CONFIG] Worker boot refused — REVIEW_PROVIDER_SUBJECT_HMAC_KEYS is unset. ' +
      'Every review provider snapshot would fail config_invalid at ' +
      'acquireDeriver() and quarantine after its retries. Set it to ' +
      '<key-version>:<64 lowercase hex> (at most two comma-separated entries) ' +
      'as a worker-only deployment variable.',
    ['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS'],
  )
}

/**
 * The GOOGLE_EGRESS_* fields that are unset. All six are an all-or-none
 * protected transport configuration, so any missing field means there is no
 * governed Google egress path.
 */
export function missingGoogleEgressConfig(
  env: DirectProviderEgressEnv,
): readonly string[] {
  const coreFields = [
    'GOOGLE_EGRESS_GATEWAY_ORIGIN',
    'GOOGLE_EGRESS_GATEWAY_SERVER_NAME',
    'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
  ] as const
  const base64Fields = GOOGLE_EGRESS_CONFIG_FIELDS.filter((field) =>
    field.endsWith('_B64'),
  )
  const missingCore = coreFields.filter((field) => !env[field])
  const configuredBase64 = base64Fields.filter((field) => env[field]).length
  const configuredPaths = GOOGLE_EGRESS_LEGACY_PATH_FIELDS.filter(
    (field) => env[field],
  ).length

  if (configuredBase64 > 0) {
    return [...missingCore, ...base64Fields.filter((field) => !env[field])]
  }
  if (configuredPaths > 0) {
    return [
      ...missingCore,
      ...GOOGLE_EGRESS_LEGACY_PATH_FIELDS.filter((field) => !env[field]),
    ]
  }
  return GOOGLE_EGRESS_CONFIG_FIELDS.filter((field) => !env[field])
}

/**
 * Credential-bearing OAuth routes never have a production direct-egress
 * exception. Unlike a bounded provider read, an authorization code, refresh
 * token, client secret, or revoke token is the credential authority itself;
 * an operator flag cannot waive the gateway/admission boundary required by
 * ADR 0050 and SAFE-04.
 */
export function assertDirectCredentialEgressAllowed(
  env: DirectProviderEgressEnv,
  operation: string,
): void {
  if (env.NODE_ENV !== 'production') return
  const missing = missingGoogleEgressConfig(env)
  throw providerConfigError(
    `[CONFIG] Refused direct Google credential egress (${operation}) — ` +
      'OAuth credential traffic must use the approved credential gateway and ' +
      'execution-admission boundary. Missing: ' +
      `${missing.length === 0 ? 'none (credential gateway transport is not wired)' : missing.join(', ')}.`,
    missing,
  )
}
