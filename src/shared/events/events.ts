// Master domain event union — re-exports all context event types.
// Per architecture: "The master DomainEvent union is in shared/events/events.ts."
// "Cross-context type imports are allowed for events."
//
// This file imports ONLY types from context domains (no runtime values).
// Event constructors are imported by infrastructure event-handlers directly
// from the context's domain/events.ts — not through this barrel.

// Identity context events
export type {
// fallow-ignore-next-line unused-type
  IdentityEvent,
// fallow-ignore-next-line unused-type
  OrganizationCreated,
// fallow-ignore-next-line unused-type
  MemberInvited,
// fallow-ignore-next-line unused-type
  InvitationAccepted,
// fallow-ignore-next-line unused-type
  InvitationRejected,
// fallow-ignore-next-line unused-type
  MemberRemoved,
// fallow-ignore-next-line unused-type
  MemberRoleChanged,
} from '#/contexts/identity/domain/events'

// Property context events
export type {
// fallow-ignore-next-line unused-type
  PropertyEvent,
// fallow-ignore-next-line unused-type
  PropertyCreated,
// fallow-ignore-next-line unused-type
  PropertyUpdated,
// fallow-ignore-next-line unused-type
  PropertyDeleted,
} from '#/contexts/property/domain/events'

// Team context events
export type {
// fallow-ignore-next-line unused-type
  TeamEvent,
// fallow-ignore-next-line unused-type
  TeamCreated,
// fallow-ignore-next-line unused-type
  TeamUpdated,
// fallow-ignore-next-line unused-type
  TeamDeleted,
} from '#/contexts/team/domain/events'

// Staff context events
export type {
// fallow-ignore-next-line unused-type
  StaffEvent,
// fallow-ignore-next-line unused-type
  StaffAssigned,
// fallow-ignore-next-line unused-type
  StaffUnassigned,
} from '#/contexts/staff/domain/events'

// Master union — adding a new context's events requires extending this.
// This ensures ts-pattern exhaustive checks catch new event types.
import type { IdentityEvent } from '#/contexts/identity/domain/events'
import type { PropertyEvent } from '#/contexts/property/domain/events'
import type { TeamEvent } from '#/contexts/team/domain/events'
import type { StaffEvent } from '#/contexts/staff/domain/events'

export type DomainEvent = IdentityEvent | PropertyEvent | TeamEvent | StaffEvent
