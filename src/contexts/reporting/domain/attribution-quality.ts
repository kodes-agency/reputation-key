// Shared attribution quality type for the metric context.
// Mirrors the portal context's type to avoid cross-context imports.

export type AttributionQuality = 'exact' | 'current_state_backfill' | 'unresolved'
