// Master domain event union.
// Per architecture: "The master DomainEvent union is in shared/events/events.ts."
// "Cross-context type imports are allowed for events."
//
// This file imports ONLY types from context domains (no runtime values).
// Event types and constructors are imported from the context's domain event
// module directly.

// Master union — adding a new context's events requires extending this.
import type { IdentityEvent } from '#/contexts/identity/domain/events'
import type { PropertyEvent } from '#/contexts/property/domain/events'
import type { PortalEvent } from '#/contexts/portal/domain/events'
import type { GuestEvent } from '#/contexts/guest/domain/events'
import type { IntegrationEvent } from '#/contexts/integration/domain/events'
import type { ReviewEvent } from '#/contexts/reputation/domain/review-events'
import type { InboxEvent } from '#/contexts/reputation/domain/inbox-events'
import type { GoalEvent } from '#/contexts/reporting/domain/goal-events'
import type { MetricEvent } from '#/contexts/reporting/domain/metric-events'
import type { AiEvent } from '#/contexts/ai/domain/events'

export type DomainEvent =
  | IdentityEvent
  | PropertyEvent
  | PortalEvent
  | GuestEvent
  | IntegrationEvent
  | ReviewEvent
  | InboxEvent
  | GoalEvent
  | MetricEvent
  | AiEvent
