import {
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationType,
} from '../domain/notification-types'
import { classifyNotification } from '../domain/notification-delivery-policy'
import { isActionableNotificationType } from '../domain/notification-settlement'
import type { NotificationAudience } from './notification-audience'

export type RegisteredNotificationConsumer = Readonly<{
  eventType: string
  consumerName: string
}>

type AudienceKind = NotificationAudience['kind']

export type BetaNotificationTriggerMatrixRow = Readonly<{
  eventType: string
  consumerName: string
  notifications: ReadonlyArray<Readonly<{ type: string; category: string }>>
  audienceKinds: ReadonlyArray<string>
  /** Identifier-only event predicate when only a subset may notify. */
  eventCondition?: string
  /**
   * Notice types this route RETIRES rather than announces: the fact finishes
   * the work they asked for. A settling route announces nothing, so it maps no
   * audience and does not count towards a type's one announcing trigger.
   */
  settles?: ReadonlyArray<string>
}>

const route = (
  eventType: string,
  consumerName: string,
  types: ReadonlyArray<NotificationType>,
  audienceKinds: ReadonlyArray<AudienceKind>,
): BetaNotificationTriggerMatrixRow => ({
  eventType,
  consumerName,
  notifications: types.map((type) => ({
    type,
    category: classifyNotification(type),
  })),
  audienceKinds,
})

/** A route that retires notices instead of raising them (ADR 0046, 2026-09-24). */
const settles = (
  eventType: string,
  consumerName: string,
  retired: ReadonlyArray<NotificationType>,
): BetaNotificationTriggerMatrixRow => ({
  eventType,
  consumerName,
  notifications: [],
  audienceKinds: [],
  settles: retired,
})

/**
 * Executable beta contract. Worker boot compares this against the consumers
 * that were actually registered; categories are derived from domain policy.
 */
export const BETA_NOTIFICATION_TRIGGER_MATRIX = [
  route(
    'identity.invitation.accepted',
    'notification.on-identity-invitation-accepted',
    ['account.organization_access_granted'],
    ['affected_organization_user'],
  ),
  route(
    'identity.member.role_changed',
    'notification.on-identity-member-role-changed',
    ['account.organization_role_changed'],
    ['affected_organization_user'],
  ),
  route(
    'identity.member.removed',
    'notification.on-identity-member-removed',
    ['account.organization_access_removed'],
    ['affected_organization_user'],
  ),
  // ADR 0059: Organization-scoped and informational, not mandatory.
  route(
    'identity.beta_feedback.outcome_reached',
    'notification.on-identity-beta-feedback-outcome',
    ['beta_feedback.outcome'],
    ['affected_organization_user'],
  ),
  {
    ...route(
      'identity.organization_lifecycle.changed',
      'notification.on-identity-organization-purge-pending',
      ['account.organization_purge_pending'],
      ['account_admin'],
    ),
    // LIF-01 program bullet 5. The lifecycle fact is recorded on every
    // transition; only Purge Pending produces the mandatory final notice.
    eventCondition: 'state === purge_pending',
  },
  {
    ...route(
      'inbox.inbox_item.created',
      'notification.on-inbox-item-created',
      ['review.created', 'feedback.created'],
      ['responsible_scope', 'account_admin'],
    ),
    // ADR 0046: Google history an import brought in is never announced; the
    // missing-notification gauge honours the same rule.
    eventCondition:
      'sourceType === feedback || first Handling Cycle is not historical_onboarding',
  },
  {
    ...route(
      'inbox.handling_cycle.opened',
      'notification.on-inbox-handling-cycle-opened',
      ['review.updated'],
      ['handling_cycle'],
    ),
    // A revision the item was created with is covered by review.created.
    eventCondition: 'openReason === material_revision_changed && !openedWithItem',
  },
  {
    ...route(
      'inbox.handling_cycle.reopened',
      'notification.on-inbox-handling-cycle-reopened',
      ['inbox.reopened'],
      ['handling_cycle'],
    ),
    // A bulk reopen's completion fact notifies for every item it stamped.
    eventCondition: 'bulkId is absent',
  },
  route(
    'inbox.inbox_items.bulk_reopen_completed',
    'notification.on-inbox-bulk-reopen-completed',
    ['inbox.bulk_reopened'],
    ['bulk_handling_cycle'],
  ),
  {
    ...route(
      'inbox.response_target.reminder_due',
      'notification.on-inbox-response-target-reminder-due',
      ['inbox.response_target_halfway', 'inbox.response_target_passed'],
      ['response_target_reminder'],
    ),
    eventCondition: 'reminderKind selects halfway or target-passed notification',
  },
  // I15: the new assignee, and on a manual reassignment the previous one.
  route(
    'inbox.inbox_item.assigned',
    'notification.on-inbox-inbox_item-assigned',
    ['inbox.assigned', 'inbox.unassigned'],
    ['inbox_assignee', 'property_operator'],
  ),
  route(
    'inbox.inbox_items.bulk_assignment_completed',
    'notification.on-inbox-bulk-assignment-completed',
    ['inbox.bulk_assigned'],
    ['bulk_inbox_assignee'],
  ),
  // One notice per Property, to the people who now own the gap; the per-item
  // unassigned facts it covers stay history.
  route(
    'inbox.inbox_items.assignments_released',
    'notification.on-inbox-assignments-released',
    ['inbox.assignments_released'],
    ['responsible_scope'],
  ),
  // I5.3: the scope that owns the item's work first, admins as the fallback.
  route(
    'inbox.inbox_item.escalated',
    'notification.on-inbox-inbox_item-escalated',
    ['inbox.escalated'],
    ['responsible_scope', 'account_admin'],
  ),
  route(
    'inbox.inbox_item.escalation_resolved',
    'notification.on-inbox-escalation-resolved',
    ['inbox.escalation_resolved'],
    ['escalation_resolution'],
  ),
  // I15: everyone already working on the item, not the assignee alone.
  route(
    'inbox.inbox_note.added',
    'notification.on-inbox-inbox_note-added',
    ['inbox_note.added'],
    ['inbox_assignee', 'inbox_note_author', 'responsible_scope', 'account_admin'],
  ),
  // I5.3: the responsible managers who hold reply.manage, admins as fallback.
  route(
    'review.reply.submitted',
    'notification.on-review-reply-submitted',
    ['reply.pending_approval'],
    ['reply_approver', 'account_admin'],
  ),
  route(
    'review.reply.approved',
    'notification.on-review-reply-approved',
    ['reply.approved'],
    ['property_operator'],
  ),
  route(
    'review.reply.rejected',
    'notification.on-review-reply-rejected',
    ['reply.rejected'],
    ['property_operator'],
  ),
  route(
    'review.reply.published',
    'notification.on-review-reply-published',
    ['reply.published'],
    ['property_operator'],
  ),
  route(
    'review.reply.publish_failed',
    'notification.on-review-reply-publish_failed',
    ['reply.publish_failed'],
    // The author while eligible; otherwise the Property's responsible managers.
    ['property_operator', 'responsible_scope'],
  ),
  // The author was told the reply was queued to publish; the approvers are the
  // ones who can send it again. A `policy` cancellation drops the approvers it
  // took the Property authority from.
  route(
    'review.reply.publication_cancelled',
    'notification.on-review-reply-publication_cancelled',
    ['reply.publication_cancelled'],
    ['property_operator', 'account_admin'],
  ),
  route(
    'portal.responsibility_became_needed',
    'notification.on-portal-responsibility-needed',
    ['portal.responsibility_needed'],
    ['responsibility_gap'],
  ),
  {
    ...route(
      'portal.health.changed',
      'notification.on-portal-health-changed',
      ['portal.health_attention'],
      ['portal_health'],
    ),
    eventCondition: 'status !== healthy && reason in actionable automatic Health reasons',
  },
  route(
    'property.responsibility_became_needed',
    'notification.on-property-responsibility-needed',
    ['property.responsibility_needed'],
    ['responsibility_gap'],
  ),
  route(
    'integration.google_account.reauthorization_required',
    'notification.on-google-reauthorization-required',
    ['integration.reauthorization_required'],
    ['account_admin'],
  ),
  // A deliberate disconnect. Organization-scoped: the connection is the
  // Organization's, and the admin who did it is left out.
  route(
    'integration.google_account.disconnected',
    'notification.on-google-account-disconnected',
    ['integration.google_disconnected'],
    ['organization_account_admin'],
  ),
  {
    ...route(
      'goal.monthly_result.closed',
      'notification.on-goal-monthly-result-closed',
      ['goal.completed'],
      ['goal_completion'],
    ),
    eventCondition: 'achieved === true',
  },
  {
    ...route(
      'goal.monthly_result.revised',
      'notification.on-goal-monthly-result-revised',
      ['goal.result_revised'],
      ['goal_result_revision'],
    ),
    eventCondition: 'outcomeChanged === true || availabilityChanged === true',
  },
  // ── Routes that settle, rather than raise, a notice ────────────────
  settles('review.reply.approved', 'notification.settle-on-review-reply-approved', [
    'reply.pending_approval',
  ]),
  settles('review.reply.rejected', 'notification.settle-on-review-reply-rejected', [
    'reply.pending_approval',
  ]),
  settles('review.reply.published', 'notification.settle-on-review-reply-published', [
    'reply.pending_approval',
    'reply.publish_failed',
  ]),
  settles(
    'inbox.inbox_item.escalation_resolved',
    'notification.settle-on-inbox-escalation-resolved',
    ['inbox.escalated'],
  ),
  settles(
    'inbox.handling_cycle.closed',
    'notification.settle-on-inbox-handling-cycle-closed',
    [
      'inbox.reopened',
      'inbox.bulk_reopened',
      'inbox.response_target_halfway',
      'inbox.response_target_passed',
    ],
  ),
  {
    ...settles(
      'property.responsible_managers.updated',
      'notification.settle-on-property-responsibility-restored',
      ['property.responsibility_needed'],
    ),
    // A selection that leaves nobody responsible opens a gap instead.
    eventCondition: 'assignmentCount > 0',
  },
  {
    ...settles(
      'portal.responsible_managers.updated',
      'notification.settle-on-portal-responsibility-restored',
      ['portal.responsibility_needed'],
    ),
    eventCondition: 'assignmentCount > 0',
  },
] as const satisfies ReadonlyArray<BetaNotificationTriggerMatrixRow>

export const BETA_DARK_NOTIFICATION_TYPES =
  [] as const satisfies ReadonlyArray<NotificationType>

const DARK_BETA_TYPES: ReadonlySet<NotificationType> = new Set(
  BETA_DARK_NOTIFICATION_TYPES,
)

const AUDIENCE_KINDS: ReadonlySet<string> = new Set<AudienceKind>([
  'affected_organization_user',
  'responsible_scope',
  'account_admin',
  'organization_account_admin',
  'reply_approver',
  'responsibility_gap',
  'inbox_assignee',
  'inbox_note_author',
  'bulk_inbox_assignee',
  'escalation_resolution',
  'handling_cycle',
  'bulk_handling_cycle',
  'response_target_reminder',
  'property_operator',
  'portal_health',
  'goal_completion',
  'goal_result_revision',
])

const registrationKey = (registration: RegisteredNotificationConsumer): string =>
  `${registration.eventType}\u0000${registration.consumerName}`

/** Structural checks that only depend on one matrix row. */
const matrixRowViolations = (
  row: BetaNotificationTriggerMatrixRow,
  registeredKeys: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const violations: string[] = []
  if (!registeredKeys.has(registrationKey(row))) {
    violations.push(
      `missing durable notification consumer ${row.consumerName} for ${row.eventType}`,
    )
  }
  const retired = row.settles ?? []
  if (row.notifications.length === 0 && retired.length === 0) {
    violations.push(`notification trigger ${row.eventType} maps no notification type`)
  }
  for (const type of retired) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
      violations.push(
        `notification trigger ${row.eventType} settles unknown type ${type}`,
      )
      continue
    }
    // Only a notice that asks for work can be finished by a fact. Settling an
    // outcome notice would hide news the reader is owed.
    if (!isActionableNotificationType(type as NotificationType)) {
      violations.push(
        `notification trigger ${row.eventType} settles ${type}, which asks its reader for nothing`,
      )
    }
  }
  for (const policy of row.notifications) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(policy.type)) {
      violations.push(
        `notification trigger ${row.eventType} maps unknown type ${policy.type}`,
      )
      continue
    }
    const expectedCategory = classifyNotification(policy.type as NotificationType)
    if (policy.category !== expectedCategory) {
      violations.push(
        `notification type ${policy.type} declares ${policy.category}, expected ${expectedCategory}`,
      )
    }
  }
  for (const audienceKind of row.audienceKinds) {
    if (!AUDIENCE_KINDS.has(audienceKind)) {
      violations.push(
        `notification trigger ${row.eventType} maps unknown audience ${audienceKind}`,
      )
    }
  }
  return violations
}

/** Every active type maps exactly once; every beta-dark type maps not at all. */
const notificationTypeCoverageViolations = (
  matrix: ReadonlyArray<BetaNotificationTriggerMatrixRow>,
): ReadonlyArray<string> => {
  const mappedTypes = matrix.flatMap((row) =>
    row.notifications.map((policy) => policy.type),
  )
  const violations: string[] = []
  for (const type of NOTIFICATION_TYPES) {
    const occurrences = mappedTypes.filter((mapped) => mapped === type).length
    if (DARK_BETA_TYPES.has(type)) {
      if (occurrences > 0)
        violations.push(`beta-dark notification type ${type} is active`)
    } else if (occurrences !== 1) {
      violations.push(
        `active beta notification type ${type} has ${occurrences} trigger mappings`,
      )
    }
  }
  return violations
}

export function betaNotificationTriggerMatrixViolations(
  registeredConsumers: ReadonlyArray<RegisteredNotificationConsumer>,
  matrix: ReadonlyArray<BetaNotificationTriggerMatrixRow> = BETA_NOTIFICATION_TRIGGER_MATRIX,
): ReadonlyArray<string> {
  const registered = registeredConsumers.filter((consumer) =>
    consumer.consumerName.startsWith('notification.'),
  )
  const registeredKeys = new Set(registered.map(registrationKey))
  const matrixKeys = new Set(matrix.map(registrationKey))

  return [
    ...matrix.flatMap((row) => matrixRowViolations(row, registeredKeys)),
    ...registered
      .filter((consumer) => !matrixKeys.has(registrationKey(consumer)))
      .map(
        (consumer) =>
          `durable notification consumer ${consumer.consumerName} for ${consumer.eventType} is absent from the beta matrix`,
      ),
    ...notificationTypeCoverageViolations(matrix),
  ]
}

export function assertBetaNotificationTriggerMatrix(
  registeredConsumers: ReadonlyArray<RegisteredNotificationConsumer>,
): void {
  const violations = betaNotificationTriggerMatrixViolations(registeredConsumers)
  if (violations.length > 0) {
    throw new Error(`Invalid beta notification trigger matrix:\n${violations.join('\n')}`)
  }
}

export type BetaNotificationPolicy = Readonly<{
  type: NotificationType
  category: NotificationCategory
}>
