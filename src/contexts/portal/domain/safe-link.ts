/** Suffixes reserved for local-only or non-routable names. */
const LOCAL_ONLY_HOST_SUFFIXES: readonly string[] = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.home.arpa',
  '.invalid',
  '.test',
  '.example',
  '.onion',
]

const IPV4_HOST_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u

const IPV4_MAPPED_PRIVATE_PATTERN =
  /^::ffff:(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/u

function normalizeDestinationHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
}

function isLocalOnlyHostName(host: string): boolean {
  if (host === 'localhost') return true
  return LOCAL_ONLY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/** `first`/`second` are the leading two octets of an IPv4 literal. */
function isPrivateIpv4Address(first: number, second: number): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  )
}

function isPrivateIpv6Address(host: string): boolean {
  return (
    host === '::' ||
    host === '::1' ||
    /^f[cd]/u.test(host) ||
    /^fe[89ab]/u.test(host) ||
    /^ff/u.test(host) ||
    IPV4_MAPPED_PRIVATE_PATTERN.test(host)
  )
}

function isPrivateDestinationHost(hostname: string): boolean {
  const host = normalizeDestinationHost(hostname)
  if (isLocalOnlyHostName(host)) return true

  const ipv4 = IPV4_HOST_PATTERN.exec(host)
  if (ipv4) return isPrivateIpv4Address(Number(ipv4[1]), Number(ipv4[2]))

  // Not an IPv6 literal: a dotless name can only resolve via a local search domain.
  if (!host.includes(':')) return !host.includes('.')
  return isPrivateIpv6Address(host)
}

/** General link-tree boundary: arbitrary public HTTPS is allowed, local targets are not. */
export function isPublicHttpsDestination(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/u.test(url)) return false
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname !== '' &&
      !isPrivateDestinationHost(parsed.hostname)
    )
  } catch {
    return false
  }
}
