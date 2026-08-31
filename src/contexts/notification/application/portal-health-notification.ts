const PORTAL_HEALTH_STATUSES = ['healthy', 'degraded', 'unavailable'] as const

const PORTAL_HEALTH_REASONS = [
  'operational',
  'publication_draft',
  'publication_disabled',
  'publication_archived',
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'responsibility_needed',
  'google_destination_awaiting_refresh',
  'google_destination_unavailable',
] as const

/** Only automatic states that give a manager a concrete recovery action. */
const ACTIONABLE_PORTAL_HEALTH_REASONS = [
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'google_destination_unavailable',
] as const

export type PortalHealthStatus = (typeof PORTAL_HEALTH_STATUSES)[number]
export type PortalHealthReason = (typeof PORTAL_HEALTH_REASONS)[number]
export type ActionablePortalHealthReason =
  (typeof ACTIONABLE_PORTAL_HEALTH_REASONS)[number]
export type ActionablePortalHealthStatus = Exclude<PortalHealthStatus, 'healthy'>

const has = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

export const isPortalHealthStatus = (value: unknown): value is PortalHealthStatus =>
  has(PORTAL_HEALTH_STATUSES, value)

export const isPortalHealthReason = (value: unknown): value is PortalHealthReason =>
  has(PORTAL_HEALTH_REASONS, value)

export const isActionablePortalHealthReason = (
  value: unknown,
): value is ActionablePortalHealthReason => has(ACTIONABLE_PORTAL_HEALTH_REASONS, value)
