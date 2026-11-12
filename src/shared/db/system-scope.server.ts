import { runInScope } from './scope-store.server'

export { SystemScopeRefusedError } from './scope-store.server'

/**
 * Run named worker or operator work that crosses tenants. A process that
 * declared itself a request process refuses, so web can never acquire it.
 */
export function withSystemScope<T>(name: string, work: () => T): T {
  return runInScope({ kind: 'system', name }, work)
}
