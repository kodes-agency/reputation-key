// The two ends of the answer to a function the build lacks: the plain 404 the
// server gives (unknown-server-function.ts) and the error Start's own client
// makes of it, which the tab reads as proof its code is older than the server's
// (release-skew-middleware.ts). The wording is the framework's, so run its real
// client against the real answer: an upgrade that changes either end fails
// here instead of leaving stale tabs on a dead page.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  runRequestChain,
  serverFnChainRequest,
} from '#/shared/testing/request-middleware-chain'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { isUnknownServerFunctionReply } from './release-skew'
import { sendWithRelease } from './release-skew-middleware'
import { createStaleTab } from './stale-tab'
import { unknownServerFunctionMiddleware } from './unknown-server-function'

type ClientFetcher = (
  url: string,
  args: readonly [{ method: 'GET' | 'POST' }],
  handler: () => Promise<Response>,
) => Promise<unknown>

async function startClientFetcher(): Promise<ClientFetcher> {
  const reactStart = createRequire(import.meta.url).resolve(
    '@tanstack/react-start/package.json',
  )
  const fetcher = join(
    dirname(reactStart),
    '..',
    'start-client-core',
    'dist',
    'esm',
    'client-rpc',
    'serverFnFetcher.js',
  )
  const { serverFnFetcher } = (await import(pathToFileURL(fetcher).href)) as {
    serverFnFetcher: ClientFetcher
  }
  // In a browser Start reads its options from a window global; under Node it
  // reads them from the server's context, which the helper seeds.
  return (url, args, handler) =>
    withStartContext(() => serverFnFetcher(url, args, handler))
}

/** What the server answers for an id its manifest lacks. */
async function serverAnswer(): Promise<Response> {
  return runRequestChain(
    [unknownServerFunctionMiddleware],
    async () => {
      throw new Error('Server function info not found for 0123abcd')
    },
    serverFnChainRequest('0123abcd'),
  )
}

describe('against the framework’s own client', () => {
  it.each(['GET', 'POST'] as const)(
    'reads the answer to a %s as the error the tab acts on',
    async (method) => {
      const serverFnFetcher = await startClientFetcher()
      const answer = await serverAnswer()

      const error = await serverFnFetcher(
        '/_serverFn/0123abcd',
        [{ method }],
        async () => answer,
      ).catch((caught: unknown) => caught)

      expect(isUnknownServerFunctionReply(error)).toBe(true)
    },
  )

  it('does not read any other plain 404 that way', async () => {
    const serverFnFetcher = await startClientFetcher()
    const notFound = new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })

    const error = await serverFnFetcher(
      '/_serverFn/0123abcd',
      [{ method: 'GET' }],
      async () => notFound,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(isUnknownServerFunctionReply(error)).toBe(false)
  })

  it('arms a stale tab whose call went through that client', async () => {
    const serverFnFetcher = await startClientFetcher()
    const tab = createStaleTab({
      storage: () => null,
      now: () => 1,
      reload: vi.fn(),
      later: vi.fn(),
    })
    tab.remember('a'.repeat(40))

    await expect(
      sendWithRelease(
        tab,
        'GET',
        async () =>
          serverFnFetcher(
            '/_serverFn/0123abcd',
            [{ method: 'GET' }],
            serverAnswer,
          ) as Promise<{ context?: unknown }>,
      ),
    ).rejects.toThrow('Unknown server function')

    expect(tab.isStale()).toBe(true)
  })
})
