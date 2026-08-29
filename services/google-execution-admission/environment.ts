import { assertReleaseIdentity } from '../../src/shared/config/release-identity'

const RUNTIME_METADATA_NAMES = Object.freeze([
  '__CF_USER_TEXT_ENCODING',
  'HOME',
  'HOSTNAME',
  'NODE_ENV',
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
  'RAILWAY_SNAPSHOT_ID',
  'RELEASE_MANIFEST_SHA256',
] as const)

const OWNED_NAMES = Object.freeze([
  'HOST',
  'PORT',
  'INTERNAL_MTLS_PORT',
  'PROCESSING_CELL',
  'DATABASE_URL',
  'GOOGLE_ADMISSION_DATABASE_CA_B64',
  'REDIS_URL',
  'PROVIDER_REDIS_TLS_CA_PEM',
  // Same duality as the mTLS material below: a deployed cell injects the PEM
  // as a variable, a compose stack mounts the file. An env FILE cannot carry
  // a multi-line PEM, and NODE_EXTRA_CA_CERTS is not an allowed name here, so
  // without this the local stack could not give the sidecar a TLS Redis at
  // all — and it was handed a plaintext one instead, which the production
  // check then refused at boot.
  'PROVIDER_REDIS_TLS_CA_PATH',
  'GOOGLE_EGRESS_GATEWAY_IDENTITY',
  'GOOGLE_ADMISSION_GRANT_HMAC_KEYS',
  'GOOGLE_INTERNAL_MTLS_CA_PATH',
  'GOOGLE_INTERNAL_MTLS_CERT_PATH',
  'GOOGLE_INTERNAL_MTLS_KEY_PATH',
  'GOOGLE_INTERNAL_MTLS_CA_B64',
  'GOOGLE_INTERNAL_MTLS_CERT_B64',
  'GOOGLE_INTERNAL_MTLS_KEY_B64',
  'RELEASE_SHA',
  'IMAGE_SOURCE_REVISION',
] as const)

const OBSERVABILITY_NAMES = Object.freeze([
  'SENTRY_DSN',
  'SENTRY_TRACES_SAMPLE_RATE',
] as const)

export const GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES = Object.freeze(
  OWNED_NAMES.filter(
    (name) => !name.endsWith('_PATH') && name !== 'PROVIDER_REDIS_TLS_CA_PEM',
  ),
)
const ALLOWED_NAMES = new Set<string>([
  ...RUNTIME_METADATA_NAMES,
  ...OWNED_NAMES,
  ...OBSERVABILITY_NAMES,
])

function normalized(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...environment,
    HOST: environment.HOST ?? '0.0.0.0',
    PORT: environment.PORT ?? '8080',
    INTERNAL_MTLS_PORT: environment.INTERNAL_MTLS_PORT ?? '8443',
    PROCESSING_CELL: environment.PROCESSING_CELL ?? 'us',
  }
}

export function assertGoogleAdmissionEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const canonicalNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const canonical = name.toUpperCase()
    if (name !== canonical || canonicalNames.has(canonical) || !ALLOWED_NAMES.has(name)) {
      throw new Error(`Google admission environment contains forbidden variable ${name}`)
    }
    canonicalNames.add(canonical)
  }
}

export function assertGoogleAdmissionRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const values = normalized(environment)
  assertGoogleAdmissionEnvironmentIsIsolated(values)
  for (const name of OWNED_NAMES.filter(
    (name) =>
      !name.startsWith('GOOGLE_INTERNAL_MTLS_') &&
      !name.startsWith('PROVIDER_REDIS_TLS_CA_'),
  )) {
    if (!values[name]) {
      throw new Error(`required Google admission setting is missing: ${name}`)
    }
  }
  if (
    values.REDIS_URL?.startsWith('rediss://') &&
    !values.PROVIDER_REDIS_TLS_CA_PEM &&
    !values.PROVIDER_REDIS_TLS_CA_PATH
  ) {
    throw new Error(
      'required Google admission setting is missing: PROVIDER_REDIS_TLS_CA_PEM or PROVIDER_REDIS_TLS_CA_PATH',
    )
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
    throw new Error('Google admission mTLS configuration is invalid')
  }
  if (
    values.HOST !== '0.0.0.0' ||
    values.PORT !== '8080' ||
    values.INTERNAL_MTLS_PORT !== '8443'
  ) {
    throw new Error('Google admission bind address is invalid')
  }
  if (values.PROCESSING_CELL !== 'us') {
    throw new Error('Google admission processing cell is invalid')
  }
  if (
    !/^[a-f0-9]{40}$/u.test(values.RELEASE_SHA ?? '') ||
    !/^[a-f0-9]{40}$/u.test(values.IMAGE_SOURCE_REVISION ?? '')
  ) {
    throw new Error('Google admission release identity is invalid')
  }
  assertReleaseIdentity({
    NODE_ENV: 'production',
    RELEASE_SHA: values.RELEASE_SHA,
    IMAGE_SOURCE_REVISION: values.IMAGE_SOURCE_REVISION,
  })
}
