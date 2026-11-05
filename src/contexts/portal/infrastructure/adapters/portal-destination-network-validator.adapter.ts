import { Resolver } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
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

async function resolvePublicAddresses(
  hostname: string,
  signal: AbortSignal,
): Promise<ResolvedAddress[]> {
  signal.throwIfAborted()
  // A resolver belongs to this hop so cancelling it cannot affect other sites.
  const resolver = new Resolver()
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const answers = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ])
    signal.throwIfAborted()
    const addresses: ResolvedAddress[] = []
    for (const [index, answer] of answers.entries()) {
      if (answer.status === 'fulfilled') {
        for (const address of new Set(answer.value))
          addresses.push({ address, family: index === 0 ? 4 : 6 })
      }
    }
    // A partial DNS outage must not hide an unvetted address family.
    for (const answer of answers) {
      if (answer.status === 'rejected') {
        const code = (answer.reason as NodeJS.ErrnoException | undefined)?.code
        if (code !== 'ENODATA' && code !== 'ENOTFOUND') throw answer.reason
      }
    }
    if (addresses.length === 0) {
      const missing = answers.find((answer) => answer.status === 'rejected')
      if (missing?.status === 'rejected') throw missing.reason
    }
    return addresses
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/**
 * Answers the connector with the one address that was vetted above, in the
 * shape that connector asked for. Happy Eyeballs (`autoSelectFamily`, on by
 * default since Node 20) passes `all: true` and expects a LIST; the older
 * contract expects `(address, family)`. Answering the list form with a bare
 * string made every connection fail with `ERR_INVALID_IP_ADDRESS`, so every
 * destination read as "temporarily unavailable" in production while unit
 * tests, which inject their own `request`, stayed green.
 */
export function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }])
      return
    }
    callback(null, address.address, address.family)
  }
}

export async function pinnedHead(
  uri: string,
  address: ResolvedAddress,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PinnedResponse> {
  const requestSignal = signal ?? AbortSignal.timeout(timeoutMs)
  const agent = new Agent({
    connect: {
      lookup: pinnedLookup(address),
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
      signal: requestSignal,
      headers: { 'user-agent': 'RepKey-Destination-Validator/1' },
    })
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel()
      response = await fetch(uri, {
        method: 'GET',
        redirect: 'manual',
        dispatcher: agent,
        signal: requestSignal,
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
    await agent.destroy()
  }
}

type AdapterDeps = Readonly<{
  clock: () => Date
  /** Transports must honor cancellation and settle only after cleanup. */
  resolve?: (hostname: string, signal: AbortSignal) => Promise<readonly ResolvedAddress[]>
  request?: (
    uri: string,
    address: ResolvedAddress,
    signal: AbortSignal,
  ) => Promise<PinnedResponse>
  maxRedirects?: number
  /** Total budget for DNS, all addresses, redirects and the GET fallback. */
  timeoutMs?: number
}>

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** A hostname that does not exist is the manager's to fix; retrying cannot. */
const DNS_NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'EAI_NONAME', 'NOTFOUND'])

function dnsFailureReason(error: unknown): 'dns_not_found' | 'dns_unavailable' {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as Readonly<{ code: unknown }>).code)
      : ''
  return DNS_NOT_FOUND_CODES.has(code) ? 'dns_not_found' : 'dns_unavailable'
}

/**
 * An apex host and its `www` form are the same site, and sites commonly serve
 * one and redirect the other. Any other host change still fails: the approved
 * destination must stay the site the manager approved.
 */
function isSameSiteHostname(next: string, original: string): boolean {
  return next === original || next === `www.${original}` || `www.${next}` === original
}

type UnsafeReason = Extract<
  PortalDestinationNetworkValidation,
  { outcome: 'unsafe' }
>['reason']
type UnavailableReason = Extract<
  PortalDestinationNetworkValidation,
  { outcome: 'unavailable' }
>['reason']

/** One hop either yields a response to classify, or settles the whole validation. */
type HopFetch =
  | Readonly<{ ok: true; response: PinnedResponse }>
  | Readonly<{ ok: false; validation: PortalDestinationNetworkValidation }>

type RedirectTarget =
  | Readonly<{ ok: true; uri: string }>
  | Readonly<{ ok: false; validation: PortalDestinationNetworkValidation }>

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
    ((uri: string, address: ResolvedAddress, signal: AbortSignal) =>
      pinnedHead(uri, address, timeoutMs, signal))
  const maxRedirects = deps.maxRedirects ?? 5

  const unsafe = (reason: UnsafeReason): PortalDestinationNetworkValidation => ({
    outcome: 'unsafe',
    reason,
    observedAt: deps.clock(),
  })
  const unavailable = (
    reason: UnavailableReason,
  ): PortalDestinationNetworkValidation => ({
    outcome: 'unavailable',
    reason,
    observedAt: deps.clock(),
  })

  /**
   * Resolves the hop's hostname, rejects the hop unless every DNS answer is
   * public, then requests through the first answer that connects.
   */
  const fetchThroughVettedAddress = async (
    currentUri: string,
    signal: AbortSignal,
  ): Promise<HopFetch> => {
    let addresses: readonly ResolvedAddress[]
    try {
      signal.throwIfAborted()
      addresses = await resolve(new URL(currentUri).hostname, signal)
      signal.throwIfAborted()
    } catch (error) {
      return { ok: false, validation: unavailable(dnsFailureReason(error)) }
    }
    if (
      addresses.length === 0 ||
      addresses.some((address) => !isPublicPortalDestinationAddress(address.address))
    ) {
      return { ok: false, validation: unsafe('dns_non_public') }
    }
    for (const address of addresses) {
      try {
        signal.throwIfAborted()
        const response = await request(currentUri, address, signal)
        signal.throwIfAborted()
        return { ok: true, response }
      } catch {
        if (signal.aborted) break
        // Try another already-vetted address. A later DNS lookup is never
        // performed inside the HTTP connector.
      }
    }
    return { ok: false, validation: unavailable('request_unavailable') }
  }

  /** A redirect may not leave the originally approved host. */
  const resolveRedirectTarget = (
    location: string | null,
    currentUri: string,
    originalHostname: string,
  ): RedirectTarget => {
    if (!location) return { ok: false, validation: unavailable('invalid_response') }
    let next
    try {
      next = validatePortalDestinationUri(new URL(location, currentUri).toString())
    } catch {
      return { ok: false, validation: unsafe('redirect_target_invalid') }
    }
    if (!isSameSiteHostname(next.hostname, originalHostname)) {
      return { ok: false, validation: unsafe('redirect_host_changed') }
    }
    return { ok: true, uri: next.normalizedUri }
  }

  return {
    async validate(uri): Promise<PortalDestinationNetworkValidation> {
      let admitted
      try {
        admitted = validatePortalDestinationUri(uri)
      } catch {
        return unsafe('redirect_target_invalid')
      }
      const originalHostname = admitted.hostname
      let currentUri = admitted.normalizedUri
      // All hops and address attempts share one deadline. Await the transport
      // after aborting so the caller never releases a still-occupied slot.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
          const hop = await fetchThroughVettedAddress(currentUri, controller.signal)
          if (!hop.ok) return hop.validation
          const { response } = hop
          if (!REDIRECT_STATUSES.has(response.status)) {
            if (response.status < 100 || response.status > 599) {
              return unavailable('invalid_response')
            }
            return {
              outcome: 'safe',
              validatedAt: deps.clock(),
              finalUri: currentUri,
              redirectCount,
            }
          }
          if (redirectCount === maxRedirects) return unsafe('redirect_limit_exceeded')
          const next = resolveRedirectTarget(
            response.location,
            currentUri,
            originalHostname,
          )
          if (!next.ok) return next.validation
          currentUri = next.uri
        }
        return unsafe('redirect_limit_exceeded')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
