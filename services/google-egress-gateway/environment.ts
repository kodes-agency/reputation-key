import { assertReleaseIdentity } from '../../src/shared/config/release-identity'

const RUNTIME_METADATA_NAMES = Object.freeze([
  '__CF_USER_TEXT_ENCODING',
  'HOME',
  'HOSTNAME',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'NODE_VERSION',
  'PATH',
  'PWD',
  'SHLVL',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'YARN_VERSION',
  'RAILWAY_BETA_ENABLE_RUNTIME_V2',
  'RAILWAY_DEPLOYMENT_ID',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_GIT_AUTHOR',
  'RAILWAY_GIT_BRANCH',
  'RAILWAY_GIT_COMMIT_MESSAGE',
  'RAILWAY_GIT_COMMIT_SHA',
  'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_REPO_OWNER',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_PROJECT_NAME',
  'RAILWAY_REPLICA_ID',
  'RAILWAY_REPLICA_REGION',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_SERVICE_NAME',
  // Railway generates one `RAILWAY_SERVICE_<NAME>_URL` per service that has a
  // public domain and injects it into EVERY service in the environment. It is
  // not stored on the service: `variableDelete` returns true and the value is
  // back on the next read (verified against the live API, 2026-08-31).
  //
  // Omitting them did not harden anything — it made this gateway unbootable on
  // Railway for a reason no operator action could clear, which is how it failed
  // the first time it ever built from git. Both AI sidecars have always allowed
  // these three and run in the same environment.
  //
  // These are sibling hostnames, not credentials. The isolation this list
  // exists for is unchanged: OPENAI_API_KEY was found set on this service and
  // is still refused.
  'RAILWAY_SERVICE_GBP_SANDBOX_URL',
  'RAILWAY_SERVICE_MAIL_SANDBOX_URL',
  'RAILWAY_SERVICE_WEB_URL',
  'RAILWAY_SNAPSHOT_ID',
  'RELEASE_MANIFEST_SHA256',
] as const)

const BASE_OWNED_NAMES = [
  'HOST',
  'PORT',
  'INTERNAL_MTLS_PORT',
  'PROCESSING_CELL',
  'GOOGLE_EXECUTION_ADMISSION_ORIGIN',
  'GOOGLE_EXECUTION_ADMISSION_SERVER_NAME',
  'GOOGLE_EGRESS_GATEWAY_IDENTITY',
  'GOOGLE_EGRESS_ALLOWED_CALLER_IDENTITIES',
  'GOOGLE_PROVIDER_ROUTE_PROFILE',
  'GOOGLE_ADMISSION_GRANT_HMAC_KEYS',
  'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
  'GOOGLE_INTERNAL_MTLS_CA_PATH',
  'GOOGLE_INTERNAL_MTLS_CERT_PATH',
  'GOOGLE_INTERNAL_MTLS_KEY_PATH',
  'GOOGLE_INTERNAL_MTLS_CA_B64',
  'GOOGLE_INTERNAL_MTLS_CERT_B64',
  'GOOGLE_INTERNAL_MTLS_KEY_B64',
  'RELEASE_SHA',
  'IMAGE_SOURCE_REVISION',
] as const

const OBSERVABILITY_NAMES = ['SENTRY_DSN', 'SENTRY_TRACES_SAMPLE_RATE'] as const

export const GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES = Object.freeze(
  BASE_OWNED_NAMES.filter((name) => !name.endsWith('_PATH')),
)

const PRODUCTION_ALLOWED_NAMES = new Set<string>([
  ...RUNTIME_METADATA_NAMES,
  ...BASE_OWNED_NAMES,
  ...OBSERVABILITY_NAMES,
])

function assertEnvironmentIsIsolatedAgainst(
  environment: Readonly<Record<string, string | undefined>>,
  allowedNames: ReadonlySet<string>,
): void {
  const canonicalNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const canonical = name.toUpperCase()
    if (name !== canonical || canonicalNames.has(canonical) || !allowedNames.has(name)) {
      throw new Error(`Google gateway environment contains forbidden variable ${name}`)
    }
    canonicalNames.add(canonical)
  }
}

export function assertGoogleGatewayEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  assertEnvironmentIsIsolatedAgainst(
    environment,
    new Set<string>([
      ...RUNTIME_METADATA_NAMES,
      ...BASE_OWNED_NAMES,
      ...OBSERVABILITY_NAMES,
      'GOOGLE_PROVIDER_SIMULATOR_ORIGIN',
    ]),
  )
}

function valuesWithDefaults(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return {
    ...environment,
    HOST: environment.HOST ?? '0.0.0.0',
    PORT: environment.PORT ?? '8080',
    INTERNAL_MTLS_PORT: environment.INTERNAL_MTLS_PORT ?? '8443',
    PROCESSING_CELL: environment.PROCESSING_CELL ?? 'us',
  }
}

function assertCommonRequiredEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): void {
  for (const name of BASE_OWNED_NAMES.filter(
    (name) => !name.startsWith('GOOGLE_INTERNAL_MTLS_'),
  )) {
    if (!values[name]) {
      throw new Error(`required Google gateway setting is missing: ${name}`)
    }
  }
  const base64Tls = [
    values.GOOGLE_INTERNAL_MTLS_CA_B64,
    values.GOOGLE_INTERNAL_MTLS_CERT_B64,
    values.GOOGLE_INTERNAL_MTLS_KEY_B64,
  ].filter(Boolean).length
  const pathTls = [
    values.GOOGLE_INTERNAL_MTLS_CA_PATH,
    values.GOOGLE_INTERNAL_MTLS_CERT_PATH,
    values.GOOGLE_INTERNAL_MTLS_KEY_PATH,
  ].filter(Boolean).length
  if (
    (base64Tls !== 0 && base64Tls !== 3) ||
    (pathTls !== 0 && pathTls !== 3) ||
    base64Tls === pathTls
  ) {
    throw new Error('Google gateway mTLS configuration is invalid')
  }
  if (
    values.HOST !== '0.0.0.0' ||
    values.PORT !== '8080' ||
    values.INTERNAL_MTLS_PORT !== '8443'
  ) {
    throw new Error('Google gateway bind address is invalid')
  }
  if (values.PROCESSING_CELL !== 'us') {
    throw new Error('Google gateway processing cell is invalid')
  }
  if (
    values.GOOGLE_EXECUTION_ADMISSION_SERVER_NAME !== 'google-execution-admission' ||
    values.GOOGLE_EGRESS_GATEWAY_IDENTITY !==
      'spiffe://repkey.internal/google-egress-gateway'
  ) {
    throw new Error('Google gateway private route is invalid')
  }
  if (
    !/^[a-f0-9]{40}$/u.test(values.RELEASE_SHA ?? '') ||
    !/^[a-f0-9]{40}$/u.test(values.IMAGE_SOURCE_REVISION ?? '')
  ) {
    throw new Error('Google gateway release identity is invalid')
  }
  assertReleaseIdentity({
    NODE_ENV: 'production',
    RELEASE_SHA: values.RELEASE_SHA,
    IMAGE_SOURCE_REVISION: values.IMAGE_SOURCE_REVISION,
  })
}

/** Production-only validator imported by the promoted gateway entry point. */
export function assertGoogleGatewayRequiredProductionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const values = valuesWithDefaults(environment)
  assertEnvironmentIsIsolatedAgainst(values, PRODUCTION_ALLOWED_NAMES)
  assertCommonRequiredEnvironment(values)
  if (
    values.GOOGLE_PROVIDER_ROUTE_PROFILE !== 'production' ||
    values.GOOGLE_EXECUTION_ADMISSION_ORIGIN !==
      'https://google-execution-admission.railway.internal:8443'
  ) {
    throw new Error('Google production gateway private route is invalid')
  }
}

/** Local-only validator; production bundling removes this entire export. */
export function assertGoogleGatewayRequiredLocalEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const values = valuesWithDefaults(environment)
  assertGoogleGatewayEnvironmentIsIsolated(values)
  assertCommonRequiredEnvironment(values)
  if (
    values.GOOGLE_PROVIDER_ROUTE_PROFILE !== 'local_sandbox' ||
    values.GOOGLE_EXECUTION_ADMISSION_ORIGIN !==
      'https://google-execution-admission:8443' ||
    !values.GOOGLE_PROVIDER_SIMULATOR_ORIGIN
  ) {
    throw new Error('Google gateway route profile is invalid')
  }
}

/** Source/test convenience validator for both explicit route profiles. */
export function assertGoogleGatewayRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.GOOGLE_PROVIDER_ROUTE_PROFILE === 'local_sandbox') {
    assertGoogleGatewayRequiredLocalEnvironment(environment)
    return
  }
  const values = valuesWithDefaults(environment)
  assertGoogleGatewayEnvironmentIsIsolated(values)
  assertCommonRequiredEnvironment(values)
  if (
    values.GOOGLE_PROVIDER_ROUTE_PROFILE !== 'production' ||
    values.GOOGLE_EXECUTION_ADMISSION_ORIGIN !==
      'https://google-execution-admission.railway.internal:8443' ||
    values.GOOGLE_PROVIDER_SIMULATOR_ORIGIN !== undefined
  ) {
    throw new Error('Google production gateway private route is invalid')
  }
}
