import type { ConsumerRegistry } from '#/shared/outbox'
import {
  handleNotificationAssignmentsReleased,
  handleNotificationBulkAssignmentCompleted,
  handleNotificationInboxEscalationResolved,
  handleNotificationResponseTargetReminder,
  type AssignmentReleaseNotificationConsumerDeps,
  type BulkAssignmentNotificationConsumerDeps,
  type EscalationResolutionNotificationConsumerDeps,
  type ResponseTargetNotificationConsumerDeps,
} from '../notify/inbox.server'

export function registerAssignmentReleaseNotificationConsumer(
  registry: ConsumerRegistry,
  deps: AssignmentReleaseNotificationConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'inbox.inbox_items.assignments_released',
    consumerName: 'notification.on-inbox-assignments-released',
    module: 'notification.assignment-release-outbox-consumers',
    handler: (event) => handleNotificationAssignmentsReleased(deps, event),
  })
}

export function registerBulkAssignmentNotificationConsumer(
  registry: ConsumerRegistry,
  deps: BulkAssignmentNotificationConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'inbox.inbox_items.bulk_assignment_completed',
    consumerName: 'notification.on-inbox-bulk-assignment-completed',
    module: 'notification.bulk-assignment-outbox-consumers',
    handler: (event) => handleNotificationBulkAssignmentCompleted(deps, event),
  })
}

export function registerEscalationResolutionNotificationConsumer(
  registry: ConsumerRegistry,
  deps: EscalationResolutionNotificationConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'inbox.inbox_item.escalation_resolved',
    consumerName: 'notification.on-inbox-escalation-resolved',
    module: 'notification.escalation-resolution-outbox-consumers',
    handler: (event) => handleNotificationInboxEscalationResolved(deps, event),
  })
}

export function registerResponseTargetNotificationConsumer(
  registry: ConsumerRegistry,
  deps: ResponseTargetNotificationConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'inbox.response_target.reminder_due',
    consumerName: 'notification.on-inbox-response-target-reminder-due',
    module: 'notification.response-target-outbox-consumers',
    handler: (event) => handleNotificationResponseTargetReminder(deps, event),
  })
}
