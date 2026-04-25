// Branded ID types for domain objects
// Each ID is a distinct type that can't be accidentally substituted for another.
// Per architecture: "always explicit" — no ambient ID context, always pass orgId.
import type { Brand } from './brand'

export type OrganizationId = Brand<string, 'OrganizationId'>
export type UserId = Brand<string, 'UserId'>
export type PropertyId = Brand<string, 'PropertyId'>
export type PortalId = Brand<string, 'PortalId'>
export type ReviewId = Brand<string, 'ReviewId'>
export type FeedbackId = Brand<string, 'FeedbackId'>
export type TeamId = Brand<string, 'TeamId'>
export type StaffAssignmentId = Brand<string, 'StaffAssignmentId'>
export type MetricId = Brand<string, 'MetricId'>
export type GoalId = Brand<string, 'GoalId'>

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
export function reviewId(id: string): ReviewId {
  return id as ReviewId
}
export function feedbackId(id: string): FeedbackId {
  return id as FeedbackId
}
export function teamId(id: string): TeamId {
  return id as TeamId
}
export function staffAssignmentId(id: string): StaffAssignmentId {
  return id as StaffAssignmentId
}
export function metricId(id: string): MetricId {
  return id as MetricId
}
export function goalId(id: string): GoalId {
  return id as GoalId
}
