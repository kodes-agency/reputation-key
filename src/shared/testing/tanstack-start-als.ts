// Test helper: invoke TanStack Start server functions outside a server runtime.
// createServerFn's middleware chain reads startOptions from a global ALS
// (see the server-fn handler invocation tests, e.g. goal/server/goals-handler.test.ts).
// In tests, seed the ALS before invoking the fn.
import { AsyncLocalStorage } from 'node:async_hooks'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')

function ensureStartALS(): AsyncLocalStorage<unknown> {
  const g = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  if (!g[START_KEY]) g[START_KEY] = new AsyncLocalStorage()
  return g[START_KEY]!
}

/** Wraps a server-fn call so the TanStack Start middleware chain can read startOptions. */
export function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  return ensureStartALS().run({ startOptions: {} }, fn)
}
