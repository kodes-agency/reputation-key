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
  IdentityOrganizationCreated,
  // fallow-ignore-next-line unused-type
  IdentityMemberInvited,
  // fallow-ignore-next-line unused-type
  IdentityInvitationAccepted,
  // fallow-ignore-next-line unused-type
  IdentityInvitationRejected,
  // fallow-ignore-next-line unused-type
  IdentityMemberRemoved,
  // fallow-ignore-next-line unused-type
  IdentityMemberRoleChanged,
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

// Portal context events
export type {
  // fallow-ignore-next-line unused-type
  PortalEvent,
  // fallow-ignore-next-line unused-type
  PortalCreated,
  // fallow-ignore-next-line unused-type
  PortalUpdated,
  // fallow-ignore-next-line unused-type
  PortalDeleted,
  // fallow-ignore-next-line unused-type
  PortalGroupCreated,
  // fallow-ignore-next-line unused-type
  PortalGroupUpdated,
  // fallow-ignore-next-line unused-type
  PortalGroupDeleted,
} from '#/contexts/portal/domain/events'

// Guest context events
export type {
  // fallow-ignore-next-line unused-type
  GuestEvent,
  // fallow-ignore-next-line unused-type
  GuestScanRecorded,
  // fallow-ignore-next-line unused-type
  GuestRatingSubmitted,
  // fallow-ignore-next-line unused-type
  GuestFeedbackSubmitted,
  // fallow-ignore-next-line unused-type
  GuestReviewLinkClicked,
} from '#/contexts/guest/domain/events'

// Integration context events
export type {
  // fallow-ignore-next-line unused-type
  IntegrationEvent,
  // fallow-ignore-next-line unused-type
  IntegrationGoogleAccountConnected,
  // fallow-ignore-next-line unused-type
  IntegrationGoogleAccountDisconnected,
  // fallow-ignore-next-line unused-type
  IntegrationGoogleConnectionVisibilityChanged,
  // fallow-ignore-next-line unused-type
  IntegrationPropertyImportCompleted,
} from '#/contexts/integration/domain/events'

// Review context events
export type {
  // fallow-ignore-next-line unused-type
  ReviewEvent,
  // fallow-ignore-next-line unused-type
  ReviewCreated,
  // fallow-ignore-next-line unused-type
  ReviewUpdated,
  // fallow-ignore-next-line unused-type
  ReviewExpired,
  // fallow-ignore-next-line unused-type
  ReviewReplyPublished,
  // fallow-ignore-next-line unused-type
  ReviewReplyPublishFailed,
} from '#/contexts/review/domain/events'

// Inbox context events
export type {
  // fallow-ignore-next-line unused-type
  InboxEvent,
  // fallow-ignore-next-line unused-type
  InboxItemCreated,
  // fallow-ignore-next-line unused-type
  InboxItemStatusChanged,
  // fallow-ignore-next-line unused-type
  InboxItemAssigned,
} from '#/contexts/inbox/domain/events'

// Goal context events
export type {
  // fallow-ignore-next-line unused-type
  GoalEvent,
  // fallow-ignore-next-line unused-type
  GoalCompleted,
} from '#/contexts/goal/domain/events'

// Metric context events
export type {
  // fallow-ignore-next-line unused-type
  MetricEvent,
  // fallow-ignore-next-line unused-type
  MetricRecorded,
} from '#/contexts/metric/domain/events'

// Badge context events
export type {
  // fallow-ignore-next-line unused-type
  BadgeEvent,
  // fallow-ignore-next-line unused-type
  BadgeAwarded,
} from '#/contexts/badge/domain/events'

// Master union — adding a new context's events requires extending this.
import type { BadgeEvent } from '#/contexts/badge/domain/events'
import type { IdentityEvent } from '#/contexts/identity/domain/events'
import type { PropertyEvent } from '#/contexts/property/domain/events'
import type { TeamEvent } from '#/contexts/team/domain/events'
import type { StaffEvent } from '#/contexts/staff/domain/events'
import type { PortalEvent } from '#/contexts/portal/domain/events'
import type { GuestEvent } from '#/contexts/guest/domain/events'
import type { IntegrationEvent } from '#/contexts/integration/domain/events'
import type { ReviewEvent } from '#/contexts/review/domain/events'
import type { InboxEvent } from '#/contexts/inbox/domain/events'
import type { GoalEvent } from '#/contexts/goal/domain/events'
import type { MetricEvent } from '#/contexts/metric/domain/events'

export type DomainEvent =
  | IdentityEvent
  | PropertyEvent
  | TeamEvent
  | StaffEvent
  | PortalEvent
  | GuestEvent
  | IntegrationEvent
  | ReviewEvent
  | InboxEvent
  | GoalEvent
  | MetricEvent
  | BadgeEvent
