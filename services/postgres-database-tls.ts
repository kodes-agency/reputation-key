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
  const url = (() => {
    try {
      return new URL(input.connectionString)
    } catch {
      return invalid()
    }
  })()
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

  const value = input.caBase64
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
