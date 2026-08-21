// Production fail-closed guards for the Google review provider path.
//
// Both guards exist because the same configuration mistake used to produce a
// process that BOOTS and then fails, silently or expensively, on every unit of
// real work:
//
//   1. REVIEW_PROVIDER_SUBJECT_HMAC_KEYS is `optional()` in the env schema but
//      MANDATORY at runtime for a worker: `acquireDeriver()` is the first thing
//      runReviewProviderSnapshot does, and without the keyring it throws
//      `config_invalid` — an opaque tagged error with no field name — for every
//      sync, three retries deep, into quarantine. In production with jobs
//      enabled the process must refuse to start instead, naming the variable.
//
//   2. The Google review adapter falls back to a DIRECT `fetch` whenever the
//      egress executor is absent, which happens merely by leaving the six
//      GOOGLE_EGRESS_* / mTLS values unset. That path bypasses admission,
//      quota control, credential binding and mTLS. In production it must
//      refuse unless an operator explicitly opts out, and the refusal must
//      name the missing configuration.
//
// Scope: NODE_ENV === 'production' only. Development, test and CI keep exactly
// the current behaviour (the canonical test env leaves these unset on purpose),
// so these guards gate on the environment, never on presence.

/** Env fields the direct-egress guard reports as missing, in report order. */
export const GOOGLE_EGRESS_CONFIG_FIELDS = [
  'GOOGLE_EGRESS_GATEWAY_ORIGIN',
  'GOOGLE_EGRESS_GATEWAY_SERVER_NAME',
  'GOOGLE_INTERNAL_MTLS_CA_PATH',
  'GOOGLE_INTERNAL_MTLS_CERT_PATH',
  'GOOGLE_INTERNAL_MTLS_KEY_PATH',
  'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
] as const

export type GoogleEgressConfigField = (typeof GOOGLE_EGRESS_CONFIG_FIELDS)[number]

export type DirectProviderEgressEnv = Readonly<
  { NODE_ENV?: string; GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS?: boolean } & Partial<
    Record<GoogleEgressConfigField, string>
  >
>

export type ReviewProviderSubjectKeysEnv = Readonly<{
  NODE_ENV?: string
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS?: string
}>

/** Tagged configuration failure. Names FIELDS only — never values. */
export class ProviderConfigError extends Error {
  readonly _tag = 'ProviderConfigError' as const
  readonly code = 'config_invalid' as const
  readonly missing: readonly string[]

  constructor(message: string, missing: readonly string[]) {
    super(message)
    this.name = 'ProviderConfigError'
    this.missing = missing
  }
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
  throw new ProviderConfigError(
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
 * protected transport configuration, so any missing field means the adapter
 * has no governed egress path and would fall back to a direct `fetch`.
 */
export function missingGoogleEgressConfig(
  env: DirectProviderEgressEnv,
): readonly GoogleEgressConfigField[] {
  return GOOGLE_EGRESS_CONFIG_FIELDS.filter((field) => !env[field])
}

/**
 * Refuse an ungoverned direct provider call in production. Returns normally
 * outside production, and in production when the operator has explicitly set
 * GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS — the documented escape hatch for a
 * deployment that knowingly runs without the egress gateway.
 */
export function assertDirectProviderEgressAllowed(
  env: DirectProviderEgressEnv,
  operation: string,
): void {
  if (env.NODE_ENV !== 'production') return
  if (env.GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS === true) return
  const missing = missingGoogleEgressConfig(env)
  throw new ProviderConfigError(
    `[CONFIG] Refused ungoverned direct Google provider call (${operation}) — ` +
      'the egress gateway is not configured, so this request would bypass ' +
      'admission, quota control, credential binding and mTLS. Missing: ' +
      `${missing.length === 0 ? 'none (executor unavailable for another reason)' : missing.join(', ')}. ` +
      'Configure the gateway, or set GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS=true ' +
      'to accept ungoverned egress deliberately.',
    missing,
  )
}
