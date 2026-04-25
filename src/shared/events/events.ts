// Master domain event union — re-exports all context event types.
// Per architecture: "The master DomainEvent union is in shared/events/events.ts."
// "Cross-context type imports are allowed for events."
//
// This file imports ONLY types from context domains (no runtime values).
// Event constructors are imported by infrastructure event-handlers directly
// from the context's domain/events.ts — not through this barrel.

// Identity context events
export type {
  IdentityEvent,
  OrganizationCreated,
  MemberInvited,
  InvitationAccepted,
  InvitationRejected,
  MemberRemoved,
  MemberRoleChanged,
} from '#/contexts/identity/domain/events'

// Property context events
export type {
  PropertyEvent,
  PropertyCreated,
  PropertyUpdated,
  PropertyDeleted,
} from '#/contexts/property/domain/events'

// Team context events
export type {
  TeamEvent,
  TeamCreated,
  TeamUpdated,
  TeamDeleted,
} from '#/contexts/team/domain/events'

// Staff context events
export type {
  StaffEvent,
  StaffAssigned,
  StaffUnassigned,
} from '#/contexts/staff/domain/events'

// Master union — adding a new context's events requires extending this.
// This ensures ts-pattern exhaustive checks catch new event types.
import type { IdentityEvent } from '#/contexts/identity/domain/events'
import type { PropertyEvent } from '#/contexts/property/domain/events'
import type { TeamEvent } from '#/contexts/team/domain/events'
import type { StaffEvent } from '#/contexts/staff/domain/events'

export type DomainEvent = IdentityEvent | PropertyEvent | TeamEvent | StaffEvent
