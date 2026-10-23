import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  answerPrintHost,
  printHostPolicy,
  type PrintHostPolicy,
} from './print-host-redirect'

const PRINT_ORIGIN = 'https://ap.up.railway.app'
const APP_ORIGIN = 'https://web-closed-beta-v2.up.railway.app'

function policyOrFail(printOrigin: string | undefined, appUrl: string): PrintHostPolicy {
  const policy = printHostPolicy(printOrigin, appUrl)
  if (policy === null) throw new Error('expected the print host to be on')
  return policy
}

const policy = policyOrFail(PRINT_ORIGIN, APP_ORIGIN)

/** The answer for `GET`, or another method, of `url`, as the web server sees the request. */
function answer(
  url: string,
  options: { method?: string; forwardedHost?: string | null } = {},
): Response | null {
  return answerPrintHost(policy, {
    method: options.method ?? 'GET',
    url,
    forwardedHost: options.forwardedHost ?? null,
  })
}

describe('printHostPolicy', () => {
  it('is on when the print host differs from the app host', () => {
    expect(printHostPolicy(PRINT_ORIGIN, APP_ORIGIN)).not.toBeNull()
  })

  it('is off when no print origin is set: nothing changes where it is unset', () => {
    expect(printHostPolicy(undefined, APP_ORIGIN)).toBeNull()
  })

  it.each([
    ['the same origin', 'https://app.reputationkey.app'],
    ['the same origin with a slash', 'https://app.reputationkey.app/'],
    ['the same host in capitals', 'https://APP.reputationkey.app'],
    ['the same host with its default port', 'https://app.reputationkey.app:443'],
    [
      'the same host on another scheme, which is the same Host header',
      'http://app.reputationkey.app',
    ],
  ])('is off when the print host is %s: a redirect would loop', (_label, printOrigin) => {
    expect(printHostPolicy(printOrigin, 'https://app.reputationkey.app')).toBeNull()
  })

  it('stays on for the same host name on another port: that is another Host header', () => {
    expect(
      printHostPolicy('http://localhost:3001', 'http://localhost:3000'),
    ).not.toBeNull()
  })

  it('reads the app host from BETTER_AUTH_URL even when it carries a path', () => {
    const withPath = policyOrFail(PRINT_ORIGIN, `${APP_ORIGIN}/ignored/base`)

    const response = answerPrintHost(withPath, {
      method: 'GET',
      url: 'https://ap.up.railway.app/p/CODE',
      forwardedHost: null,
    })

    expect(response?.headers.get('location')).toBe(`${APP_ORIGIN}/p/CODE`)
  })

  it('is off for a value that is not a URL, instead of throwing on every request', () => {
    expect(printHostPolicy('not a url', APP_ORIGIN)).toBeNull()
    expect(printHostPolicy(PRINT_ORIGIN, 'not a url')).toBeNull()
  })
})

describe('a GET or HEAD for /p/* on the print host', () => {
  it.each(['GET', 'HEAD'])(
    '%s is a 302 to the app origin, same path and query',
    (method) => {
      const response = answer(
        'https://ap.up.railway.app/p/7K3QZ0VD9MWX4HT2BN6R?locale=de',
        {
          method,
        },
      )

      expect(response?.status).toBe(302)
      expect(response?.headers.get('location')).toBe(
        `${APP_ORIGIN}/p/7K3QZ0VD9MWX4HT2BN6R?locale=de`,
      )
    },
  )

  it('is never cached and sends no referrer on to the app', () => {
    const response = answer('https://ap.up.railway.app/p/CODE')

    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('has no body', async () => {
    const response = answer('https://ap.up.railway.app/p/CODE')

    expect(await response?.text()).toBe('')
  })

  it('keeps the case of the code, which the server folds, not the redirect', () => {
    const response = answer('https://ap.up.railway.app/p/7k3qZ0vd9MWx4ht2bn6r')

    expect(response?.headers.get('location')).toBe(`${APP_ORIGIN}/p/7k3qZ0vd9MWx4ht2bn6r`)
  })

  it('keeps an encoded path and a query that carries a marker as they are', () => {
    const response = answer(
      'https://ap.up.railway.app/p/a%2Fb?accessArtifact=0b1f&x=%20y',
    )

    expect(response?.headers.get('location')).toBe(
      `${APP_ORIGIN}/p/a%2Fb?accessArtifact=0b1f&x=%20y`,
    )
  })

  it('redirects /p/ with no code too, so the app draws its own unavailable page', () => {
    expect(answer('https://ap.up.railway.app/p/')?.status).toBe(302)
  })

  it('redirects a path with more segments under /p/, as the app routes them', () => {
    const response = answer('https://ap.up.railway.app/p/CODE/more')

    expect(response?.headers.get('location')).toBe(`${APP_ORIGIN}/p/CODE/more`)
  })
})

describe('everything else on the print host', () => {
  it.each([
    '/',
    '/p',
    '/pxyz',
    '/P/CODE',
    '/_serverFn/abc123',
    '/api/health/live',
    '/api/public/p/CODE/click/link-1',
    '/assets/index-abc.js',
    '/login',
    '/manager',
    '//evil.test/p/CODE',
    // A dot segment, written either way, is resolved before the path is read:
    // both of these are /manager, and nothing under /p/ is.
    '/p/../manager',
    '/p/%2e%2e/manager',
  ])('answers 404 for GET %s', (path) => {
    expect(answer(`https://ap.up.railway.app${path}`)?.status).toBe(404)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'answers 404 for %s, even on /p/*',
    (method) => {
      expect(answer('https://ap.up.railway.app/p/CODE', { method })?.status).toBe(404)
    },
  )

  it('answers HEAD for another path with a 404 too', () => {
    expect(answer('https://ap.up.railway.app/', { method: 'HEAD' })?.status).toBe(404)
  })

  it('answers 404 with no body and nothing to cache', async () => {
    const response = answer('https://ap.up.railway.app/')

    expect(await response?.text()).toBe('')
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('location')).toBeNull()
  })
})

describe('which requests are for the print host', () => {
  it.each([
    ['the app host', 'https://web-closed-beta-v2.up.railway.app/p/CODE'],
    ['the platform health check host', 'http://healthcheck.railway.app/api/health/live'],
    ['a loopback address', 'http://127.0.0.1:3000/p/CODE'],
    ['a host that ends in the print host', 'https://xap.up.railway.app/p/CODE'],
    [
      'a host that begins with the print host',
      'https://ap.up.railway.app.evil.test/p/CODE',
    ],
    [
      'a host that has the print host as a subdomain',
      'https://x.ap.up.railway.app/p/CODE',
    ],
    [
      'a host with the print host as its user name',
      'https://ap.up.railway.app@evil.test/p/CODE',
    ],
  ])('leaves %s alone', (_label, url) => {
    expect(answer(url)).toBeNull()
  })

  it.each([
    ['capitals', 'https://AP.UP.RAILWAY.APP/p/CODE'],
    ['a trailing dot', 'https://ap.up.railway.app./p/CODE'],
    ['the default port written out', 'http://ap.up.railway.app:443/p/CODE'],
  ])('still takes the print host in %s', (_label, url) => {
    expect(answer(url)?.status).toBe(302)
  })

  it('does not take the print host on another port', () => {
    expect(answer('http://ap.up.railway.app:8080/p/CODE')).toBeNull()
  })

  it('answers for a print origin with its own port, as a local rehearsal has', () => {
    const local = policyOrFail('http://127.0.0.1:3001', 'http://127.0.0.1:3000')
    const respond = (url: string) =>
      answerPrintHost(local, { method: 'GET', url, forwardedHost: null })

    expect(respond('http://127.0.0.1:3001/p/CODE')?.status).toBe(302)
    expect(respond('http://127.0.0.1:3000/p/CODE')).toBeNull()
    expect(respond('http://127.0.0.1/p/CODE')).toBeNull()
  })

  it('answers for a print origin that is an IPv6 literal', () => {
    const local = policyOrFail('http://[::1]:3001', 'http://[::1]:3000')

    const response = answerPrintHost(local, {
      method: 'GET',
      url: 'http://[::1]:3001/p/CODE',
      forwardedHost: null,
    })

    expect(response?.headers.get('location')).toBe('http://[::1]:3000/p/CODE')
  })
})

describe('a forwarded host', () => {
  // The caller decides whether the deployment trusts the header (the middleware
  // does, by the edge contract the client address already rests on). What it
  // passes in is only ever used to take MORE requests for the print host.
  it('counts as the print host when the wire host is another name', () => {
    const response = answer('http://web.railway.internal:8080/p/CODE', {
      forwardedHost: 'ap.up.railway.app',
    })

    expect(response?.status).toBe(302)
  })

  it('answers 404 for another path of a request forwarded for the print host', () => {
    const response = answer('http://web.railway.internal:8080/login', {
      forwardedHost: 'ap.up.railway.app',
    })

    expect(response?.status).toBe(404)
  })

  it('takes any entry of a list, so a name behind another proxy still counts', () => {
    const response = answer('http://web.railway.internal:8080/p/CODE', {
      forwardedHost: 'evil.test, ap.up.railway.app',
    })

    expect(response?.status).toBe(302)
  })

  it('never lets a forwarded app host open the print host to the app', () => {
    // The wire host is the print host: whatever else a header says, it is.
    const response = answer('https://ap.up.railway.app/login', {
      forwardedHost: 'web-closed-beta-v2.up.railway.app',
    })

    expect(response?.status).toBe(404)
  })

  it.each([
    null,
    '',
    'web-closed-beta-v2.up.railway.app',
    'not a host!',
    'ap.up.railway.app@evil.test',
  ])('changes nothing for %j on the app host', (forwardedHost) => {
    expect(answer(`${APP_ORIGIN}/p/CODE`, { forwardedHost })).toBeNull()
  })

  it('redirects to the fixed app origin whatever the forwarded host says', () => {
    const response = answer('http://web.railway.internal:8080/p/CODE', {
      forwardedHost: 'ap.up.railway.app',
    })

    expect(response?.headers.get('location')).toBe(`${APP_ORIGIN}/p/CODE`)
  })
})

describe('the redirect target', () => {
  // Not an open redirect: the origin is configuration, and only a path that
  // starts /p/ is carried over, so whatever follows lands on the app host.
  it.each([
    '/p//evil.test/x',
    '/p/\\evil.test',
    '/p/@evil.test',
    '/p/https://evil.test',
    '/p/%0d%0aSet-Cookie:x=1',
    '/p/CODE?next=https://evil.test',
    '/p/CODE?next=//evil.test',
    '/p/CODE#https://evil.test',
  ])('stays on the app origin for %s', (path) => {
    const response = answer(`https://ap.up.railway.app${path}`)

    const location = response?.headers.get('location')
    expect(response?.status).toBe(302)
    expect(new URL(location ?? '').origin).toBe(APP_ORIGIN)
    expect(location?.startsWith(`${APP_ORIGIN}/p/`)).toBe(true)
  })
})

describe('what is logged', () => {
  const sinks = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  )

  afterEach(() => {
    for (const sink of sinks) sink.mockClear()
  })

  it('is nothing: no path and no code reaches a console', () => {
    answer('https://ap.up.railway.app/p/7K3QZ0VD9MWX4HT2BN6R?x=1')
    answer('https://ap.up.railway.app/login')
    answer('https://ap.up.railway.app/p/CODE', { method: 'POST' })

    for (const sink of sinks) expect(sink).not.toHaveBeenCalled()
  })
})
