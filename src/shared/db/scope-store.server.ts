import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getRequestContext,
  type RequestContext,
} from '#/shared/observability/request-context'

/** How a unit of work reached its tenant. */
export type TenantScopeEntry = 'session' | 'public' | 'job' | 'consumer'

/**
 * The database scope a unit of work runs under. Row security will admit a
 * tenant scope to its own Organization's rows and a system scope to every row;
 * a statement with no scope will see nothing.
 */
export type DatabaseScope =
  | Readonly<{
      kind: 'tenant'
      organizationId: string
      entry: TenantScopeEntry
      name: string
    }>
  | Readonly<{ kind: 'system'; name: string }>

export class SystemScopeRefusedError extends Error {
  constructor(name: string) {
    super(`system database scope refused in a request process: ${name}`)
    this.name = 'SystemScopeRefusedError'
  }
}

// Bundle copies must share one scope, just as they share the pool.
const STORE_KEY = Symbol.for('repkey.shared.db.scope')

type ScopeStore = {
  explicit: AsyncLocalStorage<DatabaseScope>
  requests: WeakMap<RequestContext, DatabaseScope>
  requestProcess: boolean
}

function store(): ScopeStore {
  const global = globalThis as { [STORE_KEY]?: ScopeStore }
  global[STORE_KEY] ??= {
    explicit: new AsyncLocalStorage<DatabaseScope>(),
    requests: new WeakMap(),
    requestProcess: false,
  }
  return global[STORE_KEY]
}

/** The web process declares itself before it serves; it can never hold system scope. */
export function declareRequestProcess(): void {
  store().requestProcess = true
}

export function runInScope<T>(scope: DatabaseScope, work: () => T): T {
  if (scope.kind === 'system' && store().requestProcess) {
    throw new SystemScopeRefusedError(scope.name)
  }
  return store().explicit.run(scope, work)
}

/**
 * Record the tenant for the rest of the current request. Requests learn their
 * tenant part-way through (after the session or a public lookup), so the
 * scope is kept beside the request's own context rather than around a call.
 */
export function markRequestScope(scope: DatabaseScope & { kind: 'tenant' }): void {
  const request = getRequestContext()
  if (request) store().requests.set(request, scope)
}

/** The innermost explicit scope, else the current request's tenant. */
export function currentScope(): DatabaseScope | undefined {
  const { explicit, requests } = store()
  const scoped = explicit.getStore()
  if (scoped) return scoped
  const request = getRequestContext()
  return request ? requests.get(request) : undefined
}

/** Test-only: forget the process declaration. */
export function resetScopeProcessForTest(): void {
  store().requestProcess = false
}
