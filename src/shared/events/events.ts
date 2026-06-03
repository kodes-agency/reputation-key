// Master domain event union — re-exports all context event types.
// Standards: docs/standards.md §1

export type {
  IdentityEvent,
  IdentityOrganizationCreated,
  IdentityMemberInvited,
  IdentityInvitationAccepted,
  IdentityInvitationRejected,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
} from '#/contexts/identity/domain/events'
export type {
  PropertyEvent,
  PropertyCreated,
  PropertyUpdated,
  PropertyDeleted,
} from '#/contexts/property/domain/events'
export type {
  TeamEvent,
  TeamCreated,
  TeamUpdated,
  TeamDeleted,
} from '#/contexts/team/domain/events'
export type {
  StaffEvent,
  StaffAssigned,
  StaffUnassigned,
} from '#/contexts/staff/domain/events'
export type {
  PortalEvent,
  PortalCreated,
  PortalUpdated,
  PortalDeleted,
  PortalLinkCategoryCreated,
  PortalLinkCategoryReordered,
  PortalLinkCreated,
  PortalLinkReordered,
  PortalGroupCreated,
  PortalGroupUpdated,
  PortalGroupDeleted,
} from '#/contexts/portal/domain/events'
export type {
  GuestEvent,
  GuestScanRecorded,
  GuestRatingSubmitted,
  GuestFeedbackSubmitted,
  GuestReviewLinkClicked,
} from '#/contexts/guest/domain/events'
export type {
  IntegrationEvent,
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleConnectionVisibilityChanged,
  IntegrationPropertyImportCompleted,
} from '#/contexts/integration/domain/events'
export type {
  ReviewEvent,
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
  ReviewReplyPublished,
  ReviewReplySubmitted,
  ReviewReplyApproved,
  ReviewReplyRejected,
} from '#/contexts/review/domain/events'
export type {
  InboxEvent,
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemAssigned,
  InboxItemUnassigned,
  InboxItemEscalated,
  InboxNoteAdded,
  InboxItemBulkStatusChanged,
} from '#/contexts/inbox/domain/events'
export type {
  GoalEvent,
  GoalCompleted,
  GoalProgressUpdated,
} from '#/contexts/goal/domain/events'
export type { MetricEvent, MetricRecorded } from '#/contexts/metric/domain/events'

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
