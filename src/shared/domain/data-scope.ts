// DataScope — the per-permission record-visibility scope for the dynamic
// authorization model (ADR 0001). v1 has no 'self' (no self-owned resource yet).

/** v1 scope union. Ordered by breadth: none < assigned-properties < organization. */
export type DataScope = 'organization' | 'assigned-properties' | 'none'

const SCOPE_RANK: Readonly<Record<DataScope, number>> = {
  none: 0,
  'assigned-properties': 1,
  organization: 2,
}

/** Runtime guard for scope strings read from organization_role_policy.data_scope. */
export function isDataScope(value: string): value is DataScope {
  return value in SCOPE_RANK
}

/** Return the broader of two scopes (organization > assigned-properties > none). */
export function broadestScope(a: DataScope, b: DataScope): DataScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b
}
