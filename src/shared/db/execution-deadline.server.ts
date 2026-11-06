import { AsyncLocalStorage } from 'node:async_hooks'

type ExecutionDeadline = Readonly<{ signal: AbortSignal; expiresAt: number }>

// Bundle copies must share the same scope, just as they share the pool.
const SCOPE_KEY = Symbol.for('repkey.shared.db.execution-deadline')

function scope(): AsyncLocalStorage<ExecutionDeadline> {
  const store = globalThis as {
    [SCOPE_KEY]?: AsyncLocalStorage<ExecutionDeadline>
  }
  store[SCOPE_KEY] ??= new AsyncLocalStorage<ExecutionDeadline>()
  return store[SCOPE_KEY]
}

export function withExecutionDeadline<T>(deadline: ExecutionDeadline, work: () => T): T {
  return scope().run(deadline, work)
}

export function getExecutionDeadline(): ExecutionDeadline | undefined {
  return scope().getStore()
}
