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

// ── Core types ────────────────────────────────────────────────────
export { Result, ok, err } from './result'

export type { TaggedError } from './errors'

export type { AuthContext } from './auth-context'

// ── Roles & permissions ───────────────────────────────────────────
export type { Role } from './roles'
export type { Permission } from './permissions'

// ── Logger port ──────────────────────────────────────────────────
export type { LoggerPort } from './logger.port'
