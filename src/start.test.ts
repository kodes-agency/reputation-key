import { describe, expect, it, vi } from 'vitest'
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
