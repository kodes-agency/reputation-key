// A request for a server function this build does not have: a probe, a bot, or a
// tab whose code names a function a deploy removed. TanStack's request handler
// throws for it below every request middleware, so Sentry's own request
// middleware (the outermost one) captured it as an unhandled error and the
// caller got a bare 500. The guard answers it with a plain 404 before any
// outer middleware can see an exception.
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Sentry from '@sentry/node'
import { sentryGlobalRequestMiddleware } from '@sentry/tanstackstart-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runRequestChain,
  serverFnChainRequest,
} from '#/shared/testing/request-middleware-chain'
import {
  UNKNOWN_SERVER_FUNCTION_BODY,
  isUnknownServerFunctionError,
  isUnknownServerFunctionId,
  unknownServerFunctionMiddleware,
} from './unknown-server-function'

const FRAMEWORK_REFUSAL = (id: string) =>
  new Error(`Server function info not found for ${id}`)

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

describe('an id the build does not have', () => {
  it('is answered with a plain 404 that no monitoring middleware ever sees as an error', async () => {
    const terminal = vi.fn(async (): Promise<{ response: Response }> => {
      throw FRAMEWORK_REFUSAL('0123abcd')
    })

    const settled = await runRequestChain(
      [sentryGlobalRequestMiddleware, unknownServerFunctionMiddleware],
      terminal,
      serverFnChainRequest('0123abcd'),
    )
    await Sentry.flush(100)

    const response = settled
    expect(response.status).toBe(404)
    expect(await response.text()).toBe(UNKNOWN_SERVER_FUNCTION_BODY)
    expect(sentEvents).toEqual([])
  })

  it('names no id and no stack in what it answers', async () => {
    const settled = await runRequestChain(
      [unknownServerFunctionMiddleware],
      async () => {
        throw FRAMEWORK_REFUSAL('secret-looking-id')
      },
      serverFnChainRequest('secret-looking-id'),
    )

    const response = settled
    expect(await response.text()).not.toContain('secret-looking-id')
    // Text, so Start's client reads it as the error message instead of failing
    // on a missing content type; never cached by a shared cache.
    expect(response.headers.get('content-type')).toMatch(/^text\/plain\b/u)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'is refused for %s without asking the framework, which would read it off the manifest object',
    async (id) => {
      const terminal = vi.fn(async (): Promise<{ response: Response }> => ({
        response: new Response('ran'),
      }))

      const settled = await runRequestChain(
        [sentryGlobalRequestMiddleware, unknownServerFunctionMiddleware],
        terminal,
        serverFnChainRequest(id),
      )

      expect(settled.status).toBe(404)
      expect(terminal).not.toHaveBeenCalled()
      expect(sentEvents).toEqual([])
    },
  )
})

describe('an id the build has', () => {
  it('reaches the framework and comes back untouched', async () => {
    const answer = new Response('{"result":1}', { status: 200 })
    const terminal = vi.fn(async (): Promise<{ response: Response }> => ({
      response: answer,
    }))

    const settled = await runRequestChain(
      [sentryGlobalRequestMiddleware, unknownServerFunctionMiddleware],
      terminal,
      serverFnChainRequest('9f2c'.repeat(16)),
    )

    expect(terminal).toHaveBeenCalledOnce()
    expect(settled).toBe(answer)
    expect(sentEvents).toEqual([])
  })

  it('still reports a failure that is not a missing function', async () => {
    const failure = new Error('chunk import failed')

    await expect(
      runRequestChain(
        [sentryGlobalRequestMiddleware, unknownServerFunctionMiddleware],
        async () => {
          throw failure
        },
        serverFnChainRequest('9f2c'.repeat(16)),
      ),
    ).rejects.toBe(failure)
    await Sentry.flush(100)

    expect(sentEvents).toHaveLength(1)
  })

  it('does not take a thrown non-error for a missing function', async () => {
    await expect(
      runRequestChain(
        [unknownServerFunctionMiddleware],
        async () => {
          throw 'Server function info not found for x'
        },
        serverFnChainRequest('x'),
      ),
    ).rejects.toBe('Server function info not found for x')
  })
})

describe('page rendering', () => {
  it('is not this middleware’s business, even for a path that looks like an id', async () => {
    const answer = new Response('<html></html>')
    const terminal = vi.fn(async (): Promise<{ response: Response }> => ({
      response: answer,
    }))

    const settled = await runRequestChain(
      [unknownServerFunctionMiddleware],
      terminal,
      serverFnChainRequest('constructor', 'router'),
    )

    expect(terminal).toHaveBeenCalledOnce()
    expect(settled).toBe(answer)
  })
})

describe('classifying what the framework throws', () => {
  it('knows the missing-function error by its wording and nothing else', () => {
    expect(isUnknownServerFunctionError(FRAMEWORK_REFUSAL('abc'))).toBe(true)
    expect(
      isUnknownServerFunctionError(
        new Error('Server function module not resolved for abc'),
      ),
    ).toBe(false)
    expect(isUnknownServerFunctionError(new Error('anything else'))).toBe(false)
    expect(isUnknownServerFunctionError('Server function info not found for abc')).toBe(
      false,
    )
    expect(isUnknownServerFunctionError(undefined)).toBe(false)
  })

  it('treats the names every object inherits as unknown ids, and hashes as possibly known', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'isPrototypeOf']) {
      expect(isUnknownServerFunctionId(id)).toBe(true)
    }
    expect(isUnknownServerFunctionId('9f2c'.repeat(16))).toBe(false)
    expect(isUnknownServerFunctionId('eyJmaWxlIjoiL3gifQ')).toBe(false)
    expect(isUnknownServerFunctionId(undefined)).toBe(false)
  })
})

// The wording and the manifest lookup above are the installed framework's, not
// ours. Generate its real resolver and make the guard answer for what it does,
// so an upgrade that rewords the error or changes the lookup fails here instead
// of turning every probe back into a 500 and an issue.
describe('against the framework’s own resolver', () => {
  async function resolver(options: { includeClientReferencedCheck: boolean }) {
    const reactStart = createRequire(import.meta.url).resolve(
      '@tanstack/react-start/package.json',
    )
    const generator = join(
      dirname(reactStart),
      '..',
      'start-plugin-core',
      'dist',
      'esm',
      'start-compiler',
      'server-fn-resolver-module.js',
    )
    const { generateServerFnResolverModule } = (await import(
      pathToFileURL(generator).href
    )) as {
      generateServerFnResolverModule: (input: unknown) => string
    }
    await readFile(generator) // a moved generator fails here, with the path in the message
    const source = generateServerFnResolverModule({
      serverFnsById: {
        known: {
          functionName: 'handler',
          extractedFilename: './known.js',
          isClientReferenced: true,
        },
      },
      useStaticImports: false,
      memoizeModules: true,
      ...options,
    }).replace('export async function getServerFnById', 'async function getServerFnById')
    return new Function(`${source}\nreturn getServerFnById`)() as (
      id: string,
      access: { origin: 'client' | 'server' },
    ) => Promise<unknown>
  }

  it.each([true, false])(
    'is told about an unknown id by an error the guard recognises (client check %s)',
    async (includeClientReferencedCheck) => {
      const getServerFnById = await resolver({ includeClientReferencedCheck })

      const error = await getServerFnById('nope', { origin: 'client' }).catch(
        (e: unknown) => e,
      )

      expect(isUnknownServerFunctionError(error)).toBe(true)
    },
  )

  it.each([true, false])(
    'is not asked about an id that only the manifest object’s prototype answers to (client check %s)',
    async (includeClientReferencedCheck) => {
      const getServerFnById = await resolver({ includeClientReferencedCheck })

      for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(isUnknownServerFunctionId(id)).toBe(true)
        // What the framework does with it is its own matter (a TypeError or a
        // refusal that is not the missing-function one); the guard never asks.
        await expect(getServerFnById(id, { origin: 'client' })).rejects.toBeInstanceOf(
          Error,
        )
      }
    },
  )
})
