import {
  currentScope,
  declareRequestProcess,
  markRequestScope,
  runInScope,
  type DatabaseScope,
  type TenantScopeEntry,
} from './scope-store.server'

export type { DatabaseScope, TenantScopeEntry }
export { declareRequestProcess }

type TenantScopeInput = Readonly<{
  organizationId: string
  entry: TenantScopeEntry
  name: string
}>

/**
 * Run work under one Organization's database scope. Every transaction the
 * shared database opens inside it sets that tenant locally, so the setting
 * ends with the transaction and never reaches the next user of the client.
 */
export function withTenantScope<T>(scope: TenantScopeInput, work: () => T): T {
  return runInScope({ kind: 'tenant', ...scope }, work)
}

/** Give the rest of the current request this Organization's scope. */
export function enterTenantScope(scope: TenantScopeInput): void {
  if (!scope.organizationId) return
  markRequestScope({ kind: 'tenant', ...scope })
}

export function getDatabaseScope(): DatabaseScope | undefined {
  return currentScope()
}
