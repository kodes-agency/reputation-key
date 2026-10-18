import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react'
import * as Sentry from '@sentry/node'
import { releaseSkewClientMiddleware } from '#/shared/stale-tab/release-skew-middleware'
import { unknownServerFunctionMiddleware } from '#/shared/stale-tab/unknown-server-function'
import {
  runRequestChain,
  serverFnChainRequest,
} from '#/shared/testing/request-middleware-chain'
import { startInstance } from './start'

type RequestResult = Response | Readonly<{ response: Response }>
type RequestMiddlewareRunner = (input: {
  request: Request
  pathname: string
  context: undefined
  handlerType: 'serverFn' | 'router'
  next: () => Promise<{
    request: Request
    pathname: string
    context: undefined
    response: Response
  }>
}) => Promise<RequestResult> | RequestResult

async function invokeCsrfRequestMiddleware(
  request: Request,
  handlerType: 'serverFn' | 'router' = 'serverFn',
) {
  const options = await startInstance.getOptions()
  const middleware = options.requestMiddleware?.[1]
  if (!middleware?.options.server) throw new Error('request middleware is not wired')
  const next = vi.fn(async () => ({
    request,
    pathname: new URL(request.url).pathname,
    context: undefined,
    response: new Response('next', { status: 200 }),
  }))
  // TanStack's generic next() preserves an arbitrary future context. This
  // harness exercises the concrete no-context middleware registered here.
  const run = middleware.options.server as unknown as RequestMiddlewareRunner
  const result = await run({
    request,
    pathname: new URL(request.url).pathname,
    context: undefined,
    handlerType,
    next,
  })
  return { result, next }
}

function serverFnRequest(headers: HeadersInit = {}): Request {
  return new Request('https://manager.repkey.example/_server/action', {
    method: 'POST',
    headers,
  })
}

describe('TanStack Start global middleware on the server', () => {
  // Vitest runs start.ts without the Start compiler, where createIsomorphicFn
  // answers with its server branch: the chains the production server runs.
  it('runs Sentry request and function middleware before the application middleware', async () => {
    const options = await startInstance.getOptions()

    expect(options.requestMiddleware).toHaveLength(4)
    expect(options.requestMiddleware?.[0]).toBe(sentryGlobalRequestMiddleware)
    expect(options.requestMiddleware?.[0]?.options.server).toBeTypeOf('function')
    expect(options.functionMiddleware).toEqual([
      sentryGlobalFunctionMiddleware,
      releaseSkewClientMiddleware,
    ])
  })

  it('asks the release question ahead of everything the server function itself has', async () => {
    const options = await startInstance.getOptions()
    const [, releaseCheck] = options.functionMiddleware ?? []

    // Global middleware runs before a function's validator, its own middleware
    // and its handler. The client half depends on the server half, which Start
    // flattens in ahead of it, so both halves are in the one registration.
    expect(releaseCheck).toBe(releaseSkewClientMiddleware)
    expect(releaseCheck?.options.middleware?.[0]?.options.server).toBeTypeOf('function')
  })
})

describe('TanStack Start request CSRF boundary', () => {
  // @proof SERVER_FN_CSRF#1
  it.each(['cross-site', 'same-site'])(
    'rejects %s server-function requests before the handler',
    async (secFetchSite) => {
      const { result, next } = await invokeCsrfRequestMiddleware(
        serverFnRequest({ 'Sec-Fetch-Site': secFetchSite }),
      )

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
      expect(next).not.toHaveBeenCalled()
    },
  )

  it('allows a same-origin server-function request', async () => {
    // @proof SERVER_FN_CSRF#2
    const { result, next } = await invokeCsrfRequestMiddleware(
      serverFnRequest({ 'Sec-Fetch-Site': 'same-origin' }),
    )

    expect((result as Readonly<{ response: Response }>).response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects a sibling-subdomain Origin when Fetch Metadata is absent', async () => {
    // @proof SERVER_FN_CSRF#3
    const { result, next } = await invokeCsrfRequestMiddleware(
      serverFnRequest({ Origin: 'https://attacker.repkey.example' }),
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects server-function requests with no origin evidence', async () => {
    const { result, next } = await invokeCsrfRequestMiddleware(serverFnRequest())

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('does not apply the server-function policy to page rendering', async () => {
    const { result, next } = await invokeCsrfRequestMiddleware(
      serverFnRequest({ 'Sec-Fetch-Site': 'cross-site' }),
      'router',
    )

    expect((result as Readonly<{ response: Response }>).response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('a request for a server function this build does not have', () => {
  const sentEvents: unknown[] = []

  beforeEach(() => {
    sentEvents.length = 0
    Sentry.init({
      dsn: 'https://public@monitoring.invalid/1',
      defaultIntegrations: false,
      integrations: [],
      transport: () => ({ send: async () => ({}), flush: async () => true }),
      beforeSend: (event) => {
        sentEvents.push(event)
        return null
      },
    })
  })

  afterEach(async () => {
    await Sentry.close()
  })

  const missing = async () => {
    throw new Error('Server function info not found for 0123abcd')
  }

  it('is registered between the CSRF boundary and the nonce, inside Sentry', async () => {
    const options = await startInstance.getOptions()

    expect(options.requestMiddleware?.[2]).toBe(unknownServerFunctionMiddleware)
  })

  // The thing the issue was about, through the chain the server registers.
  it('is answered 404 and never reaches Sentry', async () => {
    const options = await startInstance.getOptions()

    const response = await runRequestChain(
      options.requestMiddleware ?? [],
      missing,
      serverFnChainRequest('0123abcd'),
    )
    await Sentry.flush(100)

    expect(response.status).toBe(404)
    expect(sentEvents).toEqual([])
  })

  it('from another origin is still refused by the CSRF boundary first', async () => {
    const options = await startInstance.getOptions()
    const crossSite = serverFnChainRequest('0123abcd')

    const response = await runRequestChain(options.requestMiddleware ?? [], missing, {
      ...crossSite,
      request: new Request(crossSite.request, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      }),
    })

    expect(response.status).toBe(403)
  })

  it('leaves a function that exists alone', async () => {
    const options = await startInstance.getOptions()
    const answer = new Response('{"result":1}')

    const response = await runRequestChain(
      options.requestMiddleware ?? [],
      async () => ({ response: answer }),
      serverFnChainRequest('9f2c'.repeat(16)),
    )

    expect(response).toBe(answer)
    expect(sentEvents).toEqual([])
  })

  it('still reports a real failure of a function that exists', async () => {
    const options = await startInstance.getOptions()

    await expect(
      runRequestChain(
        options.requestMiddleware ?? [],
        async () => {
          throw new Error('database failed')
        },
        serverFnChainRequest('9f2c'.repeat(16)),
      ),
    ).rejects.toThrow('database failed')
    await Sentry.flush(100)

    expect(sentEvents).toHaveLength(1)
  })
})
