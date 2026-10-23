import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEnv } from '#/shared/config/env'
import { runRequestChain } from '#/shared/testing/request-middleware-chain'
import { printHostMiddleware } from './print-host-middleware'

const APP_ORIGIN = 'https://web-closed-beta-v2.up.railway.app'
const PRINT_ORIGIN = 'https://ap.up.railway.app'
const EDGE_MARKERS = { 'x-railway-edge': 'ams1', 'x-railway-request-id': 'request-1' }

function configure(settings: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value)
  resetEnv()
}

type Sent = Readonly<{ response: Response; reachedApp: boolean }>

/** One request through the middleware alone: what answered, and whether the app was reached. */
async function send(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
  handlerType: 'router' | 'serverFn' = 'router',
): Promise<Sent> {
  let reachedApp = false
  const response = await runRequestChain(
    [printHostMiddleware],
    async () => {
      reachedApp = true
      return { response: new Response('the app') }
    },
    {
      request: new Request(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
      }),
      pathname: new URL(url).pathname,
      handlerType,
    },
  )
  return { response, reachedApp }
}

beforeEach(() => {
  configure({
    BETTER_AUTH_URL: APP_ORIGIN,
    PORTAL_PRINT_ORIGIN: PRINT_ORIGIN,
    TRUSTED_PROXY_MODE: 'railway-edge',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnv()
})

describe('the print host middleware, on the Host the server received', () => {
  it('redirects a scan of /p/<code> on the print host and never reaches the app', async () => {
    const { response, reachedApp } = await send(
      'http://ap.up.railway.app/p/7K3QZ0VD9MWX4HT2BN6R?locale=de',
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `${APP_ORIGIN}/p/7K3QZ0VD9MWX4HT2BN6R?locale=de`,
    )
    expect(reachedApp).toBe(false)
  })

  it('answers 404 for a page, a server function and a POST on the print host', async () => {
    const page = await send('http://ap.up.railway.app/login')
    const fn = await send(
      'http://ap.up.railway.app/_serverFn/abc',
      { method: 'POST' },
      'serverFn',
    )
    const post = await send('http://ap.up.railway.app/p/CODE', { method: 'POST' })

    expect([page.response.status, fn.response.status, post.response.status]).toEqual([
      404, 404, 404,
    ])
    expect([page.reachedApp, fn.reachedApp, post.reachedApp]).toEqual([
      false,
      false,
      false,
    ])
  })

  it('takes the print host from its Host header where the URL carries a placeholder', async () => {
    // srvx swaps `_invalid_` in for a Host it does not accept, such as a name with a
    // trailing dot, so the header is the only place the print host still shows.
    const { response, reachedApp } = await send('http://_invalid_/p/CODE', {
      headers: { host: 'ap.up.railway.app.' },
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${APP_ORIGIN}/p/CODE`)
    expect(reachedApp).toBe(false)
  })

  it('leaves the app host alone', async () => {
    const { response, reachedApp } = await send(`${APP_ORIGIN}/p/CODE`)

    expect(await response.text()).toBe('the app')
    expect(reachedApp).toBe(true)
  })

  it('leaves the platform health check alone', async () => {
    const { reachedApp } = await send('http://healthcheck.railway.app/api/health/live')

    expect(reachedApp).toBe(true)
  })

  it('does nothing where PORTAL_PRINT_ORIGIN is unset', async () => {
    configure({ PORTAL_PRINT_ORIGIN: undefined })

    const { reachedApp } = await send('http://ap.up.railway.app/login')

    expect(reachedApp).toBe(true)
  })

  it('does nothing when the print host is the app host: the redirect is off', async () => {
    // The owner may later make the print host the app's main URL (ADR 0069).
    configure({ BETTER_AUTH_URL: PRINT_ORIGIN })

    const scan = await send(`${PRINT_ORIGIN}/p/CODE`)
    const page = await send(`${PRINT_ORIGIN}/login`)

    expect([scan.reachedApp, page.reachedApp]).toEqual([true, true])
  })
})

describe('the print host middleware, on X-Forwarded-Host', () => {
  const forwarded = { 'x-forwarded-host': 'ap.up.railway.app' }
  const behindProxy = 'http://web.railway.internal:8080/p/CODE'

  it('takes the forwarded host from Railway: the wire host names the service, not the name scanned', async () => {
    const { response } = await send(behindProxy, {
      headers: { ...forwarded, ...EDGE_MARKERS },
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${APP_ORIGIN}/p/CODE`)
  })

  it('answers 404 for another path of a request forwarded for the print host', async () => {
    const { response } = await send('http://web.railway.internal:8080/login', {
      headers: { ...forwarded, ...EDGE_MARKERS },
    })

    expect(response.status).toBe(404)
  })

  it.each([
    ['neither Railway marker', {}],
    ['only the edge marker', { 'x-railway-edge': 'ams1' }],
    ['only the request id', { 'x-railway-request-id': 'request-1' }],
  ])('ignores it behind %s, as the client address does', async (_label, markers) => {
    const { reachedApp } = await send(behindProxy, {
      headers: { ...forwarded, ...markers },
    })

    expect(reachedApp).toBe(true)
  })

  it('ignores it in direct mode, whatever else the request carries', async () => {
    configure({ TRUSTED_PROXY_MODE: 'direct' })

    const { reachedApp } = await send(behindProxy, {
      headers: { ...forwarded, ...EDGE_MARKERS },
    })

    expect(reachedApp).toBe(true)
  })

  it('is taken in xff mode with a trusted proxy, and ignored with none', async () => {
    configure({ TRUSTED_PROXY_MODE: 'xff', TRUSTED_PROXY_COUNT: '1' })
    const trusted = await send(behindProxy, { headers: forwarded })
    configure({ TRUSTED_PROXY_COUNT: '0' })
    const untrusted = await send(behindProxy, { headers: forwarded })

    expect([trusted.response.status, untrusted.reachedApp]).toEqual([302, true])
  })

  it('still answers for the print host by its wire host when the header is not trusted', async () => {
    configure({ TRUSTED_PROXY_MODE: 'direct' })

    const { response } = await send('http://ap.up.railway.app/login', {
      headers: { 'x-forwarded-host': 'web-closed-beta-v2.up.railway.app' },
    })

    expect(response.status).toBe(404)
  })

  it('never lets the header move a request off the print host', async () => {
    const { response } = await send('http://ap.up.railway.app/login', {
      headers: {
        'x-forwarded-host': 'web-closed-beta-v2.up.railway.app',
        ...EDGE_MARKERS,
      },
    })

    expect(response.status).toBe(404)
  })
})
