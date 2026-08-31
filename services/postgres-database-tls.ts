import { isIP } from 'node:net'

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u
const PEM_CERTIFICATE_CHAIN =
  /^(?:-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{1,64}={0,2}\n)+-----END CERTIFICATE-----\n)+$/u
const MAX_CA_BYTES = 1024 * 1024

export type PinnedPostgresTlsConfiguration = Readonly<{
  connectionString: string
  serverName: string
  ssl: Readonly<{
    ca: Buffer
    rejectUnauthorized: true
  }>
  dispose(): void
}>

/**
 * The connection string must name one credentialed `postgresql:` database on a
 * DNS host. A bare IP or a query string is refused, because neither can be
 * bound to the pinned certificate's server name.
 */
function pinnedPostgresUrl(connectionString: string, invalid: () => never): URL {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return invalid()
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.pathname.length < 2 ||
    url.search.length !== 0 ||
    url.hash.length !== 0 ||
    url.hostname.length === 0 ||
    isIP(url.hostname) !== 0 ||
    !DNS_NAME.test(url.hostname) ||
    url.hostname.includes('..')
  ) {
    invalid()
  }
  const port = url.port === '' ? 5432 : Number(url.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) invalid()
  return url
}

/**
 * Decode the pinned CA. The buffer is zeroed before any refusal propagates, so
 * rejected certificate material never outlives the call.
 */
function pinnedCertificateAuthority(value: string, invalid: () => never): Buffer {
  if (
    value.length === 0 ||
    value.length > Math.ceil((MAX_CA_BYTES * 4) / 3) + 4 ||
    !CANONICAL_BASE64.test(value)
  ) {
    invalid()
  }
  const ca = Buffer.from(value, 'base64')
  try {
    if (
      ca.byteLength === 0 ||
      ca.byteLength > MAX_CA_BYTES ||
      ca.toString('base64') !== value ||
      !PEM_CERTIFICATE_CHAIN.test(ca.toString('utf8'))
    ) {
      invalid()
    }
  } catch (error) {
    ca.fill(0)
    throw error
  }
  return ca
}

export function loadPinnedPostgresTlsConfiguration(
  input: Readonly<{
    connectionString: string
    caBase64: string
    invalidMessage: string
  }>,
): PinnedPostgresTlsConfiguration {
  const invalid = (): never => {
    throw new Error(input.invalidMessage)
  }
  const url = pinnedPostgresUrl(input.connectionString, invalid)
  const ca = pinnedCertificateAuthority(input.caBase64, invalid)

  let disposed = false
  return Object.freeze({
    connectionString: input.connectionString,
    serverName: url.hostname,
    ssl: Object.freeze({ ca, rejectUnauthorized: true as const }),
    dispose() {
      if (disposed) return
      disposed = true
      ca.fill(0)
    },
  })
}
