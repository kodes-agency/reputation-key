// The print host: what the web server answers on the short host a printed QR
// code or NFC tag carries (ADR 0069).
//
// The host is a redirect and nothing else. A scan of `https://ap.up.railway.app/p/<code>`
// is a 302 to the same path and query on the app's own origin, so the guest page,
// its cookies and its mutations stay on the host the guest `Origin` check expects
// (an exact match against BETTER_AUTH_URL). Every other request on the print host
// is a 404 with no body, which also stops a manager signing in on the wrong host.
//
// The target is the app origin from configuration and only a path that starts
// `/p/` is carried over, so what follows can never change the host: not an open
// redirect. Nothing here logs, and nothing reads ambient state: the caller passes
// what the request said and what it trusts (print-host-middleware.ts).

const PRINT_PATH_PREFIX = '/p/'
const REDIRECTED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/**
 * The characters a Host or X-Forwarded-Host value may have here: a DNS name, an
 * IPv4 address or a bracketed IPv6 literal, and a port. Whatever else a value
 * carries (a user name, a path, an escape) is not a host this module compares.
 */
const HOST_CHARACTERS = /^[\w.:[\]-]+$/

export type PrintHostPolicy = Readonly<{
  /** The print host, normalised (see {@link normalisedHost}), to compare with a request's. */
  host: string
  /** The print origin's scheme: a request's host is read as if it had it, so a default port drops out. */
  protocol: string
  /** The app's origin, which every redirect points at. */
  appOrigin: string
}>

export type PrintHostRequest = Readonly<{
  method: string
  /** The request URL as the web server builds it: its host is the wire `Host`. */
  url: string
  /**
   * `X-Forwarded-Host` as sent, or null. The caller passes it only where the
   * deployment trusts the proxy that sets it. It is used only to take more
   * requests for the print host, never fewer.
   */
  forwardedHost: string | null
}>

function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null
}

/**
 * A host as a URL of the print origin's scheme writes it: lower case, an IDN in
 * punycode, the scheme's default port dropped, one trailing dot dropped. A
 * request that names the print host with `:443` or in capitals is the print host.
 */
function normalisedHost(rawHost: string, protocol: string): string | undefined {
  const value = rawHost.trim()
  if (!HOST_CHARACTERS.test(value)) return undefined
  const url = parseUrl(`${protocol}//${value}`)
  if (url === null) return undefined
  const port = url.port === '' ? '' : `:${url.port}`
  return `${url.hostname.replace(/\.$/, '')}${port}`
}

/**
 * The print host's policy, or null when it is off: no print origin is set, a
 * value is not a URL (boot already refuses that), or the print host is the app
 * host. In that last case the app answers on the print host itself, so a redirect
 * would only loop, and print codes resolve on `/p/$token` directly.
 */
export function printHostPolicy(
  printOrigin: string | undefined,
  appUrl: string,
): PrintHostPolicy | null {
  if (printOrigin === undefined) return null
  const print = parseUrl(printOrigin)
  const app = parseUrl(appUrl)
  if (print === null || app === null || print.host === app.host) return null
  const host = normalisedHost(print.host, print.protocol)
  if (host === undefined) return null
  return { host, protocol: print.protocol, appOrigin: app.origin }
}

function namesPrintHost(policy: PrintHostPolicy, hosts: readonly string[]): boolean {
  return hosts.some((host) => normalisedHost(host, policy.protocol) === policy.host)
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

function redirectToApp(policy: PrintHostPolicy, url: URL): Response {
  return new Response(null, {
    status: 302,
    headers: {
      // The pathname starts `/p/`, so the app origin is the whole authority.
      Location: `${policy.appOrigin}${url.pathname}${url.search}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/**
 * What the print host answers for this request, or null when the request is for
 * another host and is none of this module's business.
 *
 * The request is for the print host when its wire host names it, or when the
 * trusted forwarded host does (or lists it). Either signal is enough because the
 * answer only ever narrows what a request gets: a spoofed header can make the
 * caller's own request a 404, and nothing a header says can open the print host
 * to the app.
 */
export function answerPrintHost(
  policy: PrintHostPolicy,
  request: PrintHostRequest,
): Response | null {
  const url = parseUrl(request.url)
  if (url === null) return null
  const forwarded = request.forwardedHost?.split(',') ?? []
  if (!namesPrintHost(policy, [url.host, ...forwarded])) return null
  const redirects =
    REDIRECTED_METHODS.has(request.method) && url.pathname.startsWith(PRINT_PATH_PREFIX)
  return redirects ? redirectToApp(policy, url) : notFound()
}
