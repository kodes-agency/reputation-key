// '@tanstack/react-start' with server functions bound the way Start's compiler
// binds them in the server build.
//
// Uncompiled, `.handler(fn)` takes `fn` for the browser's fetch stub: a call
// runs the client middleware, never validates its input and drops the
// handler's return value. The compiler hands the handler over a second time as
// the server implementation, and the server runs it through
// `__executeServer`: input validator, server middleware, handler. A call here
// takes that server path and answers with its result or throws its error.
//
// Use it as the module of a test file that calls server functions:
//   vi.mock('@tanstack/react-start', async () =>
//     (await import('#/shared/testing/compiled-server-fns')).startServerBuild)

import { vi } from 'vitest'

type StartModule = typeof import('@tanstack/react-start')
type ServerExecution = Readonly<{ result?: unknown; error?: unknown }>
type CompiledServerFn = ((opts?: { data?: unknown }) => Promise<unknown>) &
  Readonly<{
    method: string
    __executeServer: (opts: {
      data: unknown
      method: string
      context: Record<string, unknown>
    }) => Promise<ServerExecution>
  }>

const actual = await vi.importActual<StartModule>('@tanstack/react-start')

const browserOnly = () => {
  throw new Error('A server function test reached the browser fetch stub')
}

function asServerBuild<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      if (property === 'handler') {
        return (handler: unknown) => {
          const serverFn = (value as (...args: unknown[]) => CompiledServerFn).call(
            target,
            browserOnly,
            handler,
          )
          return Object.assign(async (opts?: { data?: unknown }) => {
            const executed = await serverFn.__executeServer({
              data: opts?.data,
              method: serverFn.method,
              context: {},
            })
            if (executed.error) throw executed.error
            return executed.result
          }, serverFn)
        }
      }
      return (...args: unknown[]) => {
        const next: unknown = (value as (...a: unknown[]) => unknown).apply(target, args)
        return typeof next === 'function' ? asServerBuild(next) : next
      }
    },
  })
}

const createServerFn = ((...args: Parameters<StartModule['createServerFn']>) =>
  asServerBuild(actual.createServerFn(...args))) as StartModule['createServerFn']

/** The module a test file's `vi.mock('@tanstack/react-start')` answers with. */
export const startServerBuild: StartModule = { ...actual, createServerFn }
