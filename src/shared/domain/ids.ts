// Branded ID types for domain objects
// Each ID is a distinct type that can't be accidentally substituted for another.
// Per architecture: "always explicit" — no ambient ID context, always pass orgId.
import type { Brand } from './brand'

export type OrganizationId = Brand<string, 'OrganizationId'>
export type UserId = Brand<string, 'UserId'>
export type PropertyId = Brand<string, 'PropertyId'>
export type PortalId = Brand<string, 'PortalId'>
// ReviewId, FeedbackId — deferred to Phase 8/9
export type TeamId = Brand<string, 'TeamId'>
export type StaffAssignmentId = Brand<string, 'StaffAssignmentId'>
// MetricId, GoalId — deferred to Phase 10/11
export type PortalLinkCategoryId = Brand<string, 'PortalLinkCategoryId'>
export type PortalLinkId = Brand<string, 'PortalLinkId'>

// Convenience constructors — each wraps brandId with the correct tag.
// These are the only acceptable `as` casts: branded ID parsing.
export function organizationId(id: string): OrganizationId {
  return id as OrganizationId
}
export function userId(id: string): UserId {
  return id as UserId
}
export function propertyId(id: string): PropertyId {
  return id as PropertyId
}
export function portalId(id: string): PortalId {
  return id as PortalId
}

export function teamId(id: string): TeamId {
  return id as TeamId
}
export function staffAssignmentId(id: string): StaffAssignmentId {
  return id as StaffAssignmentId
}

export function portalLinkCategoryId(id: string): PortalLinkCategoryId {
  return id as PortalLinkCategoryId
}
export function portalLinkId(id: string): PortalLinkId {
  return id as PortalLinkId
}
