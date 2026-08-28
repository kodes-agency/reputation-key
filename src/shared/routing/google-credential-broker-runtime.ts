import { isIP } from 'node:net'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export const GOOGLE_CREDENTIAL_BROKER_LIVE_EXECUTION_ENABLED = false as const

const BROKER_FIELDS = [
  'GOOGLE_CREDENTIAL_BROKER_PUBLIC_ORIGIN',
  'GOOGLE_CREDENTIAL_BROKER_SERVER_NAME',
  'GOOGLE_CREDENTIAL_BROKER_SERVICE_IDENTITY',
  'GOOGLE_CREDENTIAL_BROKER_PEER_IDENTITIES',
  'GOOGLE_CREDENTIAL_BROKER_MTLS_CA_B64',
  'GOOGLE_CREDENTIAL_BROKER_MTLS_CERT_B64',
  'GOOGLE_CREDENTIAL_BROKER_MTLS_KEY_B64',
  'GOOGLE_CREDENTIAL_BROKER_SIGNATURE_HMAC_KEYS',
  'GOOGLE_CREDENTIAL_BROKER_REPLAY_HMAC_KEYS',
  'GOOGLE_CREDENTIAL_ROUTING_HMAC_KEYS',
] as const

export type GoogleCredentialBrokerRuntimeConfig =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'validate_only'
      publicEndpoint: Readonly<{
        hostname: string
        port: number
        serverName: string
      }>
      serviceIdentity: string
      peerIdentities: readonly string[]
      mtls: Readonly<{ caB64: string; certB64: string; keyB64: string }>
      keyVersions: Readonly<{
        protocolSignature: string
        replayLookup: string
        routingDirectory: string
      }>
    }>

function value(input: Record<string, unknown>, field: string): string | undefined {
  const raw = input[field]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((entry) => !Number.isInteger(entry))) {
    return false
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

function isAsciiLetterOrDigit(value: string): boolean {
  const code = value.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
}

function isDnsHostname(hostname: string): boolean {
  if (hostname.length < 1 || hostname.length > 253) return false
  const labels = hostname.split('.')
  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) return false
    if (!isAsciiLetterOrDigit(label[0]!) || !isAsciiLetterOrDigit(label.at(-1)!)) {
      return false
    }
    return [...label].every(
      (character) => character === '-' || isAsciiLetterOrDigit(character),
    )
  })
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.railway.internal')
  ) {
    return false
  }
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return !isPrivateIpv4(normalized)
  if (ipVersion === 6) {
    return !(
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  return isDnsHostname(normalized)
}

function assertPemBase64(encoded: string, label: string): void {
  let decoded: string
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    throw new Error(`Google credential broker ${label} mTLS value is invalid`)
  }
  if (!decoded.includes('-----BEGIN ') || !decoded.includes('-----END ')) {
    throw new Error(`Google credential broker ${label} mTLS value is invalid`)
  }
}

function validatedActiveKeyVersion(raw: string): string {
  const keyring = createVersionedHmacKeyring(raw)
  try {
    return keyring.activeVersion
  } finally {
    keyring.dispose()
  }
}

export function parseGoogleCredentialBrokerRuntimeConfig(
  input: Record<string, unknown>,
): GoogleCredentialBrokerRuntimeConfig {
  const mode = value(input, 'GOOGLE_CREDENTIAL_BROKER_MODE') ?? 'disabled'
  if (mode !== 'disabled' && mode !== 'validate_only') {
    throw new Error('Google credential broker mode is invalid')
  }
  const configured = BROKER_FIELDS.filter((field) => value(input, field) !== undefined)
  if (mode === 'disabled') {
    if (configured.length !== 0) {
      throw new Error('Google credential broker transport is configured while disabled')
    }
    return Object.freeze({ mode: 'disabled' })
  }
  if (configured.length !== BROKER_FIELDS.length) {
    throw new Error('Google credential broker transport configuration is incomplete')
  }
  const origin = new URL(value(input, 'GOOGLE_CREDENTIAL_BROKER_PUBLIC_ORIGIN')!)
  if (origin.protocol !== 'tls:') {
    throw new Error('Google credential broker public transport must use self-TLS')
  }
  if (origin.username || origin.password) {
    throw new Error('Google credential broker public endpoint cannot contain credentials')
  }
  if (
    !origin.hostname ||
    !origin.port ||
    origin.pathname !== '' ||
    origin.search ||
    origin.hash ||
    !isPublicHostname(origin.hostname)
  ) {
    throw new Error('Google credential broker endpoint must be a public TCP endpoint')
  }
  const port = Number(origin.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Google credential broker public TCP port is invalid')
  }
  const serverName = value(input, 'GOOGLE_CREDENTIAL_BROKER_SERVER_NAME')!
  if (!isPublicHostname(serverName) || isIP(serverName) !== 0) {
    throw new Error('Google credential broker TLS server name is invalid')
  }
  const serviceIdentity = value(input, 'GOOGLE_CREDENTIAL_BROKER_SERVICE_IDENTITY')!
  if (!/^spiffe:\/\/repkey\/[A-Za-z0-9._:/-]{1,200}$/u.test(serviceIdentity)) {
    throw new Error('Google credential broker service identity is invalid')
  }
  const peerIdentities = value(input, 'GOOGLE_CREDENTIAL_BROKER_PEER_IDENTITIES')!
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort()
  if (
    peerIdentities.length === 0 ||
    peerIdentities.some(
      (identity) => !/^spiffe:\/\/repkey\/[A-Za-z0-9._:/-]{1,200}$/u.test(identity),
    )
  ) {
    throw new Error('Google credential broker peer identity is invalid')
  }
  if (new Set(peerIdentities).size !== peerIdentities.length) {
    throw new Error('Google credential broker peer identity is duplicated')
  }
  if (peerIdentities.includes(serviceIdentity)) {
    throw new Error('Google credential broker peer identity cannot equal the service')
  }
  const caB64 = value(input, 'GOOGLE_CREDENTIAL_BROKER_MTLS_CA_B64')!
  const certB64 = value(input, 'GOOGLE_CREDENTIAL_BROKER_MTLS_CERT_B64')!
  const keyB64 = value(input, 'GOOGLE_CREDENTIAL_BROKER_MTLS_KEY_B64')!
  assertPemBase64(caB64, 'CA')
  assertPemBase64(certB64, 'certificate')
  assertPemBase64(keyB64, 'key')
  const keyVersions = Object.freeze({
    protocolSignature: validatedActiveKeyVersion(
      value(input, 'GOOGLE_CREDENTIAL_BROKER_SIGNATURE_HMAC_KEYS')!,
    ),
    replayLookup: validatedActiveKeyVersion(
      value(input, 'GOOGLE_CREDENTIAL_BROKER_REPLAY_HMAC_KEYS')!,
    ),
    routingDirectory: validatedActiveKeyVersion(
      value(input, 'GOOGLE_CREDENTIAL_ROUTING_HMAC_KEYS')!,
    ),
  })
  return Object.freeze({
    mode: 'validate_only',
    publicEndpoint: Object.freeze({ hostname: origin.hostname, port, serverName }),
    serviceIdentity,
    peerIdentities: Object.freeze(peerIdentities),
    mtls: Object.freeze({ caB64, certB64, keyB64 }),
    keyVersions,
  })
}

export type GoogleCredentialBrokerReadiness = Readonly<{
  configurationReady: boolean
  protocolValidationReady: boolean
  crossCellExecutionReady: false
  readyForCurrentTraffic: boolean
  code:
    | 'disabled'
    | 'validation_dependency_unavailable'
    | 'live_evidence_pending'
    | 'live_execution_dark'
}>

export function evaluateGoogleCredentialBrokerReadiness(
  input: Readonly<{
    config: GoogleCredentialBrokerRuntimeConfig
    signedDirectoryCurrent: boolean
    durableReplayStoreReachable: boolean
    peerCertificateEvidenceCurrent: boolean
    liveCrossCellDrillCurrent: boolean
    crossCellRouteCount: number
  }>,
): GoogleCredentialBrokerReadiness {
  if (input.config.mode === 'disabled') {
    return Object.freeze({
      configurationReady: true,
      protocolValidationReady: false,
      crossCellExecutionReady: false,
      readyForCurrentTraffic: input.crossCellRouteCount === 0,
      code: input.crossCellRouteCount === 0 ? 'disabled' : 'live_execution_dark',
    })
  }
  const protocolValidationReady =
    input.signedDirectoryCurrent && input.durableReplayStoreReachable
  if (!protocolValidationReady) {
    return Object.freeze({
      configurationReady: true,
      protocolValidationReady: false,
      crossCellExecutionReady: false,
      readyForCurrentTraffic: false,
      code: 'validation_dependency_unavailable',
    })
  }
  const evidenceCurrent =
    input.peerCertificateEvidenceCurrent && input.liveCrossCellDrillCurrent
  return Object.freeze({
    configurationReady: true,
    protocolValidationReady: true,
    crossCellExecutionReady: false,
    readyForCurrentTraffic: input.crossCellRouteCount === 0,
    code:
      input.crossCellRouteCount > 0
        ? 'live_execution_dark'
        : evidenceCurrent
          ? 'live_execution_dark'
          : 'live_evidence_pending',
  })
}
