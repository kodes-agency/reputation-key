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
import {
  handleNotificationBulkReopenCompleted,
  handleNotificationHandlingCycle,
  type HandlingCycleNotificationConsumerDeps,
} from '../notify/inbox-handling-cycle.server'
import {
  handleWorkflowNotificationEvent,
  type WorkflowNotificationConsumerDeps,
} from '../notify/inbox-workflow.server'

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

export function registerWorkflowNotificationConsumers(
  registry: ConsumerRegistry,
  deps: WorkflowNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'inbox.inbox_item.assigned',
    consumerName: 'notification.on-inbox-inbox_item-assigned',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.inbox_item.escalated',
    consumerName: 'notification.on-inbox-inbox_item-escalated',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.inbox_note.added',
    consumerName: 'notification.on-inbox-inbox_note-added',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.submitted',
    consumerName: 'notification.on-review-reply-submitted',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.approved',
    consumerName: 'notification.on-review-reply-approved',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.rejected',
    consumerName: 'notification.on-review-reply-rejected',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.published',
    consumerName: 'notification.on-review-reply-published',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.publish_failed',
    consumerName: 'notification.on-review-reply-publish_failed',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.publication_cancelled',
    consumerName: 'notification.on-review-reply-publication_cancelled',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
}

export function registerHandlingCycleNotificationConsumers(
  registry: ConsumerRegistry,
  deps: HandlingCycleNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'inbox.handling_cycle.opened',
    consumerName: 'notification.on-inbox-handling-cycle-opened',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationHandlingCycle(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.handling_cycle.reopened',
    consumerName: 'notification.on-inbox-handling-cycle-reopened',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationHandlingCycle(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.inbox_items.bulk_reopen_completed',
    consumerName: 'notification.on-inbox-bulk-reopen-completed',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationBulkReopenCompleted(deps, event),
  })
}
