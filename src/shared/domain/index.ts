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
  ScanEventId,
  RatingId,
  FeedbackId,
  ActivityLogId,
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
  scanEventId,
  ratingId,
  feedbackId,
  activityLogId,
} from './ids'

// ── Core types ────────────────────────────────────────────────────
export { Result, ok, err } from './result'

export type { TaggedError } from './errors'
export { createErrorFactory } from './errors'

export type { AuthContext } from './auth-context'

// ── Roles & permissions ───────────────────────────────────────────
export type { Role } from './roles'
export { hasRole, ROLE_HIERARCHY, toDomainRole, toBetterAuthRole } from './roles'
export type { Permission } from './permissions'

// ── Slug normalization ─────────────────────────────────────────────
export { normalizeSlug } from './slug'

// ── Exhaustive-never assertion ───────────────────────────────────
export { assertNever, UnreachableError } from './assert'

// ── Logger port ──────────────────────────────────────────────────
export type { LoggerPort } from './logger.port'

// ── Timezones ─────────────────────────────────────────────────────
export { VALID_TIMEZONES } from './timezones'
