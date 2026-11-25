// DataScope — the per-permission record-visibility scope for the dynamic
// authorization model (ADR 0001). v1 has no 'self' (no self-owned resource yet).

/** v1 scope union. Ordered by breadth: none < assigned-properties < organization. */
export type DataScope = 'organization' | 'assigned-properties' | 'none'
