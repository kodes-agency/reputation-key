// Shared domain barrel — re-exports all shared domain utilities
// Contexts import from here, never from the individual files directly.

// ── Branded IDs ───────────────────────────────────────────────────
export type {
  OrganizationId,
  UserId,
  PropertyId,
  PortalId,
  TeamId,
  StaffAssignmentId,
  PortalLinkCategoryId,
  PortalLinkId,
} from './ids'

// ── ID constructors ───────────────────────────────────────────────
export {
  organizationId,
  userId,
  propertyId,
  portalId,
  teamId,
  staffAssignmentId,
  portalLinkCategoryId,
  portalLinkId,
} from './ids'

// ── Core types ────────────────────────────────────────────────────
export type { Result } from './result'
export { ok, err } from './result'

export type { TaggedError } from './errors'
export { createErrorFactory } from './errors'

export type { Clock } from './clock'
export type { AuthContext } from './auth-context'

// ── Roles & permissions ───────────────────────────────────────────
export type { Role } from './roles'
export { hasRole, ROLE_HIERARCHY, toDomainRole, toBetterAuthRole } from './roles'
export type { Permission } from './permissions'

// ── Timezones ─────────────────────────────────────────────────────
export { VALID_TIMEZONES } from './timezones'
