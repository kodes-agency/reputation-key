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
  IdentityOrganizationCreated,
  IdentityMemberInvited,
  IdentityInvitationAccepted,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
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

// Portal context events
export type {
  PortalEvent,
  PortalCreated,
  PortalUpdated,
  PortalDeleted,
  PortalGroupCreated,
  PortalGroupUpdated,
  PortalGroupDeleted,
} from '#/contexts/portal/domain/events'

// Guest context events
export type {
  GuestEvent,
  GuestScanRecorded,
  GuestRatingSubmitted,
  GuestFeedbackSubmitted,
  GuestReviewLinkClicked,
} from '#/contexts/guest/domain/events'

// Integration context events
export type {
  IntegrationEvent,
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleConnectionVisibilityChanged,
  IntegrationPropertyImportCompleted,
} from '#/contexts/integration/domain/events'

// Review context events
export type {
  ReviewEvent,
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyPublicationCancelled,
  ReviewReplyUpdated,
} from '#/contexts/review/domain/events'

// Inbox context events
export type {
  InboxEvent,
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemAssigned,
} from '#/contexts/inbox/domain/events'

// Goal context events
export type { GoalEvent, GoalCompleted } from '#/contexts/goal/domain/events'

// Metric context events
export type { MetricEvent, MetricRecorded } from '#/contexts/metric/domain/events'

// Badge context events
export type { BadgeEvent, BadgeAwarded } from '#/contexts/badge/domain/events'

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
