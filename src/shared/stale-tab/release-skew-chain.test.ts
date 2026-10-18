// The release check against a real server function, run through Start's own
// middleware executor: the same global chain `src/start.ts` registers, the same
// order. What the unit tests of each half cannot show is that a refused read
// never reaches the function's validator or handler, and that a flag from a
// finished mutation arrives where the tab's half reads it.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServerFn } from '@tanstack/react-start'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_HEADER, STALE_CLIENT_CODE } from './release-skew'

const hoisted = vi.hoisted(() => ({ release: 'b'.repeat(40), headers: new Headers() }))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://manager.example/_server/x', { headers: hoisted.headers }),
}))
vi.mock('#/shared/config/request-runtime-config', () => ({
  requestRuntimeConfig: () => ({ env: { RELEASE_SHA: hoisted.release } }),
}))

const { releaseSkewClientMiddleware } = await import('./release-skew-middleware')

const OLD = 'a'.repeat(40)
const START_KEY = Symbol.for('tanstack-start:start-storage-context')

type ServerResult = Readonly<{ result?: unknown; error?: unknown; context?: unknown }>
type ExecutableServerFn = Readonly<{
  __executeServer: (input: {
    data: undefined
    method: 'GET' | 'POST'
    context: object
  }) => Promise<ServerResult>
}>

/** What the compiler turns `.handler(fn)` into on the server: the stub, then the real function. */
function serverFn(method: 'GET' | 'POST', handler: () => Promise<string>) {
  const factory = createServerFn({ method }) as unknown as {
    handler: (stub: () => void, real: () => Promise<string>) => ExecutableServerFn
  }
  return factory.handler(() => undefined, handler)
}

function run(
  fn: ExecutableServerFn,
  method: 'GET' | 'POST',
  tabRelease: string | null,
): Promise<ServerResult> {
  hoisted.headers = new Headers(tabRelease ? { [RELEASE_HEADER]: tabRelease } : {})
  const globals = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  const storage = (globals[START_KEY] ??= new AsyncLocalStorage())
  return storage.run(
    {
      startOptions: { functionMiddleware: [releaseSkewClientMiddleware] },
      request: new Request('https://manager.example/_server/x', {
        headers: hoisted.headers,
      }),
      contextAfterGlobalMiddlewares: {},
    },
    () => fn.__executeServer({ data: undefined, method, context: {} }),
  )
}

beforeEach(() => {
  hoisted.release = 'b'.repeat(40)
})

describe('release skew through a real server function', () => {
  it('runs the handler for a tab on the same release', async () => {
    const handler = vi.fn(async () => 'ran')

    const outcome = await run(serverFn('GET', handler), 'GET', hoisted.release)

    expect(handler).toHaveBeenCalledOnce()
    expect(outcome.result).toBe('ran')
    expect(outcome.error).toBeUndefined()
  })

  it('refuses a read from an older tab before the handler starts', async () => {
    const handler = vi.fn(async () => 'ran')

    const outcome = await run(serverFn('GET', handler), 'GET', OLD)

    expect(handler).not.toHaveBeenCalled()
    expect(outcome.error).toMatchObject({ code: STALE_CLIENT_CODE, status: 409 })
  })

  it('finishes a mutation from an older tab and sends the flag back', async () => {
    const handler = vi.fn(async () => 'saved')

    const outcome = await run(serverFn('POST', handler), 'POST', OLD)

    expect(handler).toHaveBeenCalledOnce()
    expect(outcome.result).toBe('saved')
    expect(outcome.context).toEqual({ releaseSkew: true })
  })

  it('sends no flag to a tab that is current', async () => {
    const outcome = await run(
      serverFn('POST', async () => 'saved'),
      'POST',
      hoisted.release,
    )

    expect(outcome.context).toEqual({})
  })

  it('leaves a caller that sends no release alone', async () => {
    const handler = vi.fn(async () => 'ran')

    const outcome = await run(serverFn('GET', handler), 'GET', null)

    expect(handler).toHaveBeenCalledOnce()
    expect(outcome.result).toBe('ran')
  })
})

type CallableServerFn = ExecutableServerFn &
  ((input?: { data?: undefined }) => Promise<unknown>)

/**
 * A server function with the wire between its two halves replaced by a function
 * call: what the tab's half sends (its headers) is what the server's half reads,
 * and what the server answers is what the tab's half receives.
 */
function wiredServerFn(method: 'GET' | 'POST', handler: () => Promise<string>) {
  const built: { server?: ExecutableServerFn } = {}
  const wire = async (payload: { headers?: HeadersInit }): Promise<ServerResult> => {
    hoisted.headers = new Headers(payload.headers)
    const answered = await built.server?.__executeServer({
      data: undefined,
      method,
      context: {},
    })
    return answered ?? {}
  }
  const factory = createServerFn({ method }) as unknown as {
    handler: (stub: typeof wire, real: () => Promise<string>) => CallableServerFn
  }
  const fn = factory.handler(wire, handler)
  built.server = fn
  return fn
}

type TabModules = Readonly<{
  middleware: typeof releaseSkewClientMiddleware
  tab: (typeof import('./stale-tab'))['staleTab']
}>

/** A tab of its own: its state is module state, so each test loads the modules afresh. */
async function openTab(): Promise<TabModules> {
  vi.resetModules()
  const [{ releaseSkewClientMiddleware: middleware }, { staleTab: tab }] =
    await Promise.all([import('./release-skew-middleware'), import('./stale-tab')])
  return { middleware, tab }
}

function callAsTab<T>(modules: TabModules, fn: () => Promise<T>): Promise<T> {
  const globals = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  const storage = (globals[START_KEY] ??= new AsyncLocalStorage())
  return storage.run(
    {
      startOptions: { functionMiddleware: [modules.middleware] },
      request: new Request('https://manager.example/_server/x'),
      contextAfterGlobalMiddlewares: {},
    },
    fn,
  )
}

describe('release skew, from the tab through the wire and back', () => {
  beforeEach(() => {
    hoisted.release = 'b'.repeat(40)
  })

  it('refuses a read from a stale tab, hands the caller the typed outcome, and arms the tab', async () => {
    const tab = await openTab()
    tab.tab.remember(OLD)
    const handler = vi.fn(async () => 'ran')
    const read = wiredServerFn('GET', handler)

    const outcome = await callAsTab(tab, () => read()).catch((error: unknown) => error)

    expect(outcome).toMatchObject({ code: STALE_CLIENT_CODE, status: 409 })
    expect(handler).not.toHaveBeenCalled()
    expect(hoisted.headers.get(RELEASE_HEADER)).toBe(OLD)
    expect(tab.tab.isStale()).toBe(true)
  })

  it('finishes a mutation for a stale tab and arms it, so the next navigation reloads', async () => {
    const tab = await openTab()
    tab.tab.remember(OLD)
    const handler = vi.fn(async () => 'saved')
    const write = wiredServerFn('POST', handler)

    const outcome = await callAsTab(tab, () => write())

    expect(outcome).toBe('saved')
    expect(handler).toHaveBeenCalledOnce()
    expect(tab.tab.isStale()).toBe(true)
  })

  it('says nothing and arms nothing for a tab on the current release', async () => {
    const tab = await openTab()
    tab.tab.remember(hoisted.release)
    const read = wiredServerFn('POST', async () => 'ran')

    const outcome = await callAsTab(tab, () => read())

    expect(outcome).toBe('ran')
    expect(hoisted.headers.get(RELEASE_HEADER)).toBe(hoisted.release)
    expect(tab.tab.isStale()).toBe(false)
  })

  it('sends no header from a tab that does not know its release', async () => {
    const tab = await openTab()
    tab.tab.remember(null)
    const read = wiredServerFn('GET', async () => 'ran')

    await callAsTab(tab, () => read())

    expect(hoisted.headers.has(RELEASE_HEADER)).toBe(false)
  })
})
