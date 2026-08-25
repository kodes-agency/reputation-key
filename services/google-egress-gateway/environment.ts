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
  'RAILWAY_SNAPSHOT_ID',
  'RELEASE_MANIFEST_SHA256',
] as const)

const OWNED_NAMES = Object.freeze([
  'HOST',
  'PORT',
  'GOOGLE_EXECUTION_ADMISSION_ORIGIN',
  'GOOGLE_EXECUTION_ADMISSION_SERVER_NAME',
  'GOOGLE_EGRESS_GATEWAY_IDENTITY',
  'GOOGLE_EGRESS_ALLOWED_CALLER_IDENTITIES',
  'GOOGLE_PROVIDER_ROUTE_PROFILE',
  'GOOGLE_PROVIDER_SIMULATOR_ORIGIN',
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
] as const)

export const GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES = Object.freeze(
  OWNED_NAMES.filter(
    (name) => !name.endsWith('_PATH') && name !== 'GOOGLE_PROVIDER_SIMULATOR_ORIGIN',
  ),
)

const ALLOWED_NAMES = new Set<string>([...RUNTIME_METADATA_NAMES, ...OWNED_NAMES])

export function assertGoogleGatewayEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const canonicalNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const canonical = name.toUpperCase()
    if (name !== canonical || canonicalNames.has(canonical) || !ALLOWED_NAMES.has(name)) {
      throw new Error(`Google gateway environment contains forbidden variable ${name}`)
    }
    canonicalNames.add(canonical)
  }
}

export function assertGoogleGatewayRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const values: Readonly<Record<string, string | undefined>> = {
    ...environment,
    HOST: environment.HOST ?? '0.0.0.0',
    PORT: environment.PORT ?? '8443',
  }
  assertGoogleGatewayEnvironmentIsIsolated(values)
  for (const name of OWNED_NAMES.filter(
    (name) =>
      !name.startsWith('GOOGLE_INTERNAL_MTLS_') &&
      name !== 'GOOGLE_PROVIDER_SIMULATOR_ORIGIN',
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
  if (values.HOST !== '0.0.0.0' || values.PORT !== '8443') {
    throw new Error('Google gateway bind address is invalid')
  }
  if (
    values.GOOGLE_EXECUTION_ADMISSION_SERVER_NAME !== 'google-execution-admission' ||
    values.GOOGLE_EGRESS_GATEWAY_IDENTITY !==
      'spiffe://repkey.internal/google-egress-gateway'
  ) {
    throw new Error('Google gateway private route is invalid')
  }
  if (values.GOOGLE_PROVIDER_ROUTE_PROFILE === 'production') {
    if (
      values.GOOGLE_EXECUTION_ADMISSION_ORIGIN !==
        'https://google-execution-admission.railway.internal:8443' ||
      values.GOOGLE_PROVIDER_SIMULATOR_ORIGIN !== undefined
    ) {
      throw new Error('Google production gateway private route is invalid')
    }
  } else if (
    values.GOOGLE_PROVIDER_ROUTE_PROFILE !== 'local_sandbox' ||
    values.GOOGLE_EXECUTION_ADMISSION_ORIGIN !==
      'https://google-execution-admission:8443' ||
    !values.GOOGLE_PROVIDER_SIMULATOR_ORIGIN
  ) {
    throw new Error('Google gateway route profile is invalid')
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
