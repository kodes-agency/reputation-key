import { isIP } from 'node:net'

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u
const PEM_CERTIFICATE_CHAIN =
  /^(?:-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{1,64}={0,2}\n)+-----END CERTIFICATE-----\n)+$/u
const MAX_CA_BYTES = 1024 * 1024

function invalid(): never {
  throw new Error('AI admission control database TLS configuration is invalid')
}

function decodeCa(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length > Math.ceil((MAX_CA_BYTES * 4) / 3) + 4 ||
    !CANONICAL_BASE64.test(value)
  ) {
    invalid()
  }
  const decoded = Buffer.from(value, 'base64')
  try {
    if (
      decoded.byteLength === 0 ||
      decoded.byteLength > MAX_CA_BYTES ||
      decoded.toString('base64') !== value ||
      !PEM_CERTIFICATE_CHAIN.test(decoded.toString('utf8'))
    ) {
      invalid()
    }
    return decoded
  } catch (error) {
    decoded.fill(0)
    throw error
  }
}

export type AiControlDatabaseTlsConfiguration = Readonly<{
  connectionString: string
  serverName: string
  ssl: Readonly<{
    ca: Buffer
    rejectUnauthorized: true
  }>
  dispose(): void
}>

export function loadAiControlDatabaseTlsConfiguration(
  input: Readonly<{
    connectionString: string
    caBase64: string
  }>,
): AiControlDatabaseTlsConfiguration {
  let url: URL
  try {
    url = new URL(input.connectionString)
  } catch {
    invalid()
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

  const ca = decodeCa(input.caBase64)
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
