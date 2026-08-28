import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Agent, fetch } from 'undici'
import type {
  PortalDestinationNetworkValidation,
  PortalDestinationNetworkValidator,
} from '../../application/ports/portal-destination-network-validator.port'
import { validatePortalDestinationUri } from '../../domain/approved-destination'

type ResolvedAddress = Readonly<{ address: string; family: 4 | 6 }>
type PinnedResponse = Readonly<{ status: number; location: string | null }>

const FORBIDDEN_IPV4_ADDRESSES = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  FORBIDDEN_IPV4_ADDRESSES.addSubnet(network, prefix, 'ipv4')
}
const FORBIDDEN_IPV6_ADDRESSES = new BlockList()
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  FORBIDDEN_IPV6_ADDRESSES.addSubnet(network, prefix, 'ipv6')
}

export function isPublicPortalDestinationAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !FORBIDDEN_IPV4_ADDRESSES.check(address, 'ipv4')
  if (family !== 6 || FORBIDDEN_IPV6_ADDRESSES.check(address, 'ipv6')) return false
  // Fail closed to the currently allocated global-unicast block. Link-local,
  // ULA, multicast, transition and documentation ranges are rejected above.
  const first = Number.parseInt(address.split(':')[0] || '0', 16)
  return first >= 0x2000 && first <= 0x3fff
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) return []
  const unique = new Map<string, ResolvedAddress>()
  for (const address of addresses) {
    if ((address.family !== 4 && address.family !== 6) || !address.address) continue
    unique.set(`${address.family}:${address.address}`, {
      address: address.address,
      family: address.family,
    })
  }
  return [...unique.values()]
}

async function pinnedHead(
  uri: string,
  address: ResolvedAddress,
  timeoutMs: number,
): Promise<PinnedResponse> {
  const agent = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address.address, address.family)
      },
      timeout: timeoutMs,
    },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxResponseSize: 1_024,
  })
  try {
    let response = await fetch(uri, {
      method: 'HEAD',
      redirect: 'manual',
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'RepKey-Destination-Validator/1' },
    })
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel()
      response = await fetch(uri, {
        method: 'GET',
        redirect: 'manual',
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': 'RepKey-Destination-Validator/1',
          range: 'bytes=0-0',
        },
      })
    }
    const result = {
      status: response.status,
      location: response.headers.get('location'),
    }
    await response.body?.cancel()
    return result
  } finally {
    await agent.close()
  }
}

type AdapterDeps = Readonly<{
  clock: () => Date
  resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>
  request?: (uri: string, address: ResolvedAddress) => Promise<PinnedResponse>
  maxRedirects?: number
  timeoutMs?: number
}>

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Validates every DNS answer and pins each outbound connection to an answer
 * that was checked before the socket opens. Redirects are followed manually,
 * re-resolved at every hop, and may not leave the originally approved host.
 */
export const createPortalDestinationNetworkValidator = (
  deps: AdapterDeps,
): PortalDestinationNetworkValidator => {
  const resolve = deps.resolve ?? resolvePublicAddresses
  const timeoutMs = deps.timeoutMs ?? 5_000
  const request =
    deps.request ??
    ((uri: string, address: ResolvedAddress) => pinnedHead(uri, address, timeoutMs))
  const maxRedirects = deps.maxRedirects ?? 5

  return {
    async validate(uri): Promise<PortalDestinationNetworkValidation> {
      let admitted
      try {
        admitted = validatePortalDestinationUri(uri)
      } catch {
        return {
          outcome: 'unsafe',
          reason: 'redirect_target_invalid',
          observedAt: deps.clock(),
        }
      }
      const originalHostname = admitted.hostname
      let currentUri = admitted.normalizedUri
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const current = new URL(currentUri)
        let addresses: readonly ResolvedAddress[]
        try {
          addresses = await resolve(current.hostname)
        } catch {
          return {
            outcome: 'unavailable',
            reason: 'dns_unavailable',
            observedAt: deps.clock(),
          }
        }
        if (
          addresses.length === 0 ||
          addresses.some((address) => !isPublicPortalDestinationAddress(address.address))
        ) {
          return {
            outcome: 'unsafe',
            reason: 'dns_non_public',
            observedAt: deps.clock(),
          }
        }
        let response: PinnedResponse | null = null
        for (const address of addresses) {
          try {
            response = await request(currentUri, address)
            break
          } catch {
            // Try another already-vetted address. A later DNS lookup is never
            // performed inside the HTTP connector.
          }
        }
        if (!response) {
          return {
            outcome: 'unavailable',
            reason: 'request_unavailable',
            observedAt: deps.clock(),
          }
        }
        if (!REDIRECT_STATUSES.has(response.status)) {
          if (response.status < 100 || response.status > 599) {
            return {
              outcome: 'unavailable',
              reason: 'invalid_response',
              observedAt: deps.clock(),
            }
          }
          return {
            outcome: 'safe',
            validatedAt: deps.clock(),
            finalUri: currentUri,
            redirectCount,
          }
        }
        if (redirectCount === maxRedirects) {
          return {
            outcome: 'unsafe',
            reason: 'redirect_limit_exceeded',
            observedAt: deps.clock(),
          }
        }
        if (!response.location) {
          return {
            outcome: 'unavailable',
            reason: 'invalid_response',
            observedAt: deps.clock(),
          }
        }
        let next
        try {
          next = validatePortalDestinationUri(
            new URL(response.location, currentUri).toString(),
          )
        } catch {
          return {
            outcome: 'unsafe',
            reason: 'redirect_target_invalid',
            observedAt: deps.clock(),
          }
        }
        if (next.hostname !== originalHostname) {
          return {
            outcome: 'unsafe',
            reason: 'redirect_host_changed',
            observedAt: deps.clock(),
          }
        }
        currentUri = next.normalizedUri
      }
      return {
        outcome: 'unsafe',
        reason: 'redirect_limit_exceeded',
        observedAt: deps.clock(),
      }
    },
  }
}
