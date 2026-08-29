import {
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationType,
} from '../domain/types'
import { classifyNotification } from '../domain/notification-delivery-policy'
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
  {
    ...route(
      'identity.organization_lifecycle.changed',
      'notification.on-identity-organization-purge-pending',
      ['account.organization_purge_pending'],
      ['account_admin'],
    ),
    // LIF-01 program bullet 5. The lifecycle fact is emitted on every
    // transition; only Purge Pending produces the mandatory final notice.
    eventCondition: 'state === purge_pending',
  },
  route(
    'inbox.inbox_item.created',
    'notification.on-inbox-item-created',
    ['review.created', 'feedback.created'],
    ['responsible_scope', 'account_admin'],
  ),
  {
    ...route(
      'inbox.handling_cycle.opened',
      'notification.on-inbox-handling-cycle-opened',
      ['review.updated'],
      ['handling_cycle'],
    ),
    eventCondition: 'openReason === material_revision_changed',
  },
  route(
    'inbox.handling_cycle.reopened',
    'notification.on-inbox-handling-cycle-reopened',
    ['inbox.reopened'],
    ['handling_cycle'],
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
  route(
    'inbox.inbox_item.assigned',
    'notification.on-inbox-inbox_item-assigned',
    ['inbox.assigned'],
    ['inbox_assignee'],
  ),
  route(
    'inbox.inbox_items.bulk_assignment_completed',
    'notification.on-inbox-bulk-assignment-completed',
    ['inbox.bulk_assigned'],
    ['bulk_inbox_assignee'],
  ),
  route(
    'inbox.inbox_item.escalated',
    'notification.on-inbox-inbox_item-escalated',
    ['inbox.escalated'],
    ['account_admin'],
  ),
  route(
    'inbox.inbox_item.escalation_resolved',
    'notification.on-inbox-escalation-resolved',
    ['inbox.escalation_resolved'],
    ['escalation_resolution'],
  ),
  route(
    'inbox.inbox_note.added',
    'notification.on-inbox-inbox_note-added',
    ['inbox_note.added'],
    ['inbox_assignee', 'responsible_scope', 'account_admin'],
  ),
  route(
    'review.reply.submitted',
    'notification.on-review-reply-submitted',
    ['reply.pending_approval'],
    ['account_admin'],
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
    ['property_operator'],
  ),
  route(
    'portal.responsibility_became_needed',
    'notification.on-portal-responsibility-needed',
    ['portal.responsibility_needed'],
    ['account_admin'],
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
    ['account_admin'],
  ),
  route(
    'integration.google_account.reauthorization_required',
    'notification.on-google-reauthorization-required',
    ['integration.reauthorization_required'],
    ['account_admin'],
  ),
  {
    ...route(
      'goal.monthly_result.closed',
      'notification.on-goal-monthly-result-closed',
      ['goal.completed'],
      ['responsible_scope'],
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
] as const satisfies ReadonlyArray<BetaNotificationTriggerMatrixRow>

/** Badge is the only deliberately unavailable beta notification family. */
export const BETA_DARK_NOTIFICATION_TYPES = [
  'badge.awarded',
] as const satisfies ReadonlyArray<NotificationType>

const DARK_BETA_TYPES: ReadonlySet<NotificationType> = new Set(
  BETA_DARK_NOTIFICATION_TYPES,
)

export type BetaNotificationEventFamilyEvidence = Readonly<{
  eventType: string
  version: number
  schemaRegistered: boolean
  recordedInOutbox: boolean
  disposition: string
  consumers: ReadonlyArray<
    Readonly<{
      name: string
      kind: string
      disposition: string
    }>
  >
}>

type BetaNotificationReadinessRequirement = Readonly<{
  eventType: string
  version: number
  owner: string
  notificationType: NotificationType | null
  audienceKinds: ReadonlyArray<AudienceKind>
  eventCondition?: string
  /** False for durable evidence that intentionally has no user delivery. */
  expectsNotification?: false
}>

/**
 * Active beta families that are not yet represented by a complete durable
 * trigger/recipient row. This is executable debt, not a dark-feature list.
 *
 * Canonical Goal Programs close `goal.monthly_result.closed:v1`; the legacy
 * `goal.completed` producer is compatibility-only and must never be revived.
 */
const BETA_NOTIFICATION_READINESS_REQUIREMENTS = [
  {
    eventType: 'goal.monthly_result.closed',
    version: 1,
    owner: 'GOA/NTF',
    notificationType: 'goal.completed',
    audienceKinds: ['responsible_scope'],
    eventCondition: 'achieved === true',
  },
  {
    eventType: 'goal.monthly_result.reconciled',
    version: 1,
    owner: 'GOA',
    notificationType: null,
    audienceKinds: [],
    expectsNotification: false,
  },
  {
    eventType: 'goal.monthly_result.revised',
    version: 1,
    owner: 'GOA/NTF',
    notificationType: 'goal.result_revised',
    audienceKinds: ['goal_result_revision'],
    eventCondition: 'outcomeChanged === true || availabilityChanged === true',
  },
  {
    eventType: 'inbox.handling_cycle.opened',
    version: 1,
    owner: 'IBX/NTF',
    notificationType: 'review.updated',
    audienceKinds: ['handling_cycle'],
    eventCondition: 'openReason === material_revision_changed',
  },
  {
    eventType: 'inbox.handling_cycle.reopened',
    version: 1,
    owner: 'IBX/NTF',
    notificationType: 'inbox.reopened',
    audienceKinds: ['handling_cycle'],
  },
  {
    eventType: 'inbox.response_target.reminder_due',
    version: 1,
    owner: 'IBX/NTF',
    notificationType: 'inbox.response_target_halfway',
    audienceKinds: ['response_target_reminder'],
    eventCondition: 'reminderKind selects halfway or target-passed notification',
  },
  {
    eventType: 'inbox.inbox_item.escalation_resolved',
    version: 1,
    owner: 'INB/NTF',
    notificationType: 'inbox.escalation_resolved',
    audienceKinds: ['escalation_resolution'],
  },
  {
    eventType: 'portal.health.changed',
    version: 1,
    owner: 'POR/NTF',
    notificationType: 'portal.health_attention',
    audienceKinds: ['portal_health'],
    eventCondition: 'status !== healthy && reason in actionable automatic Health reasons',
  },
] as const satisfies ReadonlyArray<BetaNotificationReadinessRequirement>

const AUDIENCE_KINDS: ReadonlySet<string> = new Set<AudienceKind>([
  'affected_organization_user',
  'responsible_scope',
  'account_admin',
  'inbox_assignee',
  'bulk_inbox_assignee',
  'escalation_resolution',
  'handling_cycle',
  'response_target_reminder',
  'property_operator',
  'portal_health',
  'goal_result_revision',
])

const registrationKey = (registration: RegisteredNotificationConsumer): string =>
  `${registration.eventType}\u0000${registration.consumerName}`

export function betaNotificationTriggerMatrixViolations(
  registeredConsumers: ReadonlyArray<RegisteredNotificationConsumer>,
  matrix: ReadonlyArray<BetaNotificationTriggerMatrixRow> = BETA_NOTIFICATION_TRIGGER_MATRIX,
): ReadonlyArray<string> {
  const violations: string[] = []
  const registered = registeredConsumers.filter((consumer) =>
    consumer.consumerName.startsWith('notification.'),
  )
  const registeredKeys = new Set(registered.map(registrationKey))
  const matrixKeys = new Set(matrix.map(registrationKey))

  for (const row of matrix) {
    if (!registeredKeys.has(registrationKey(row))) {
      violations.push(
        `missing durable notification consumer ${row.consumerName} for ${row.eventType}`,
      )
    }
    if (row.notifications.length === 0) {
      violations.push(`notification trigger ${row.eventType} maps no notification type`)
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
  }

  for (const consumer of registered) {
    if (!matrixKeys.has(registrationKey(consumer))) {
      violations.push(
        `durable notification consumer ${consumer.consumerName} for ${consumer.eventType} is absent from the beta matrix`,
      )
    }
  }

  const mappedTypes = matrix.flatMap((row) =>
    row.notifications.map((policy) => policy.type),
  )
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

export type BetaNotificationReadinessGap = Readonly<{
  eventType: string
  owner: string
  code:
    | 'event_not_catalogued'
    | 'event_schema_unregistered'
    | 'event_not_enabled'
    | 'producer_not_durable'
    | 'consumer_not_catalogued'
    | 'trigger_unmapped'
    | 'consumer_not_registered'
    | 'notification_type_unmapped'
    | 'audience_policy_incomplete'
    | 'event_condition_incomplete'
    | 'unexpected_notification_trigger'
  detail: string
}>

export type BetaNotificationReadinessReport = Readonly<{
  ready: boolean
  structuralViolations: ReadonlyArray<string>
  gaps: ReadonlyArray<BetaNotificationReadinessGap>
}>

/**
 * Release-readiness report against real consumer registrations and event
 * catalogue evidence. Known cross-context work remains visible without
 * weakening worker boot or misclassifying an active family as beta-dark.
 */
export function betaNotificationReadinessReport(
  registeredConsumers: ReadonlyArray<RegisteredNotificationConsumer>,
  eventFamilies: ReadonlyArray<BetaNotificationEventFamilyEvidence>,
  matrix: ReadonlyArray<BetaNotificationTriggerMatrixRow> = BETA_NOTIFICATION_TRIGGER_MATRIX,
): BetaNotificationReadinessReport {
  const structuralViolations = betaNotificationTriggerMatrixViolations(
    registeredConsumers,
    matrix,
  )
  const registeredKeys = new Set(
    registeredConsumers
      .filter((consumer) => consumer.consumerName.startsWith('notification.'))
      .map(registrationKey),
  )
  const gaps: BetaNotificationReadinessGap[] = []

  // Every active trigger — not only the families that were incomplete when
  // this matrix was introduced — must still have a durable source fact. This
  // catches a producer/catalogue regression even when registration and type
  // routing inside Notification remain structurally intact.
  for (const row of matrix) {
    const evidence = eventFamilies.find((family) => family.eventType === row.eventType)
    if (!evidence) {
      gaps.push({
        eventType: row.eventType,
        owner: 'NTF/source',
        code: 'event_not_catalogued',
        detail: `${row.eventType} is absent from the event catalogue`,
      })
    } else if (!evidence.schemaRegistered) {
      gaps.push({
        eventType: row.eventType,
        owner: 'NTF/source',
        code: 'event_schema_unregistered',
        detail: `${row.eventType}:v${evidence.version} has no registered schema`,
      })
    } else if (!evidence.recordedInOutbox) {
      gaps.push({
        eventType: row.eventType,
        owner: 'NTF/source',
        code: 'producer_not_durable',
        detail: `${row.eventType}:v${evidence.version} is not recorded in the outbox`,
      })
    } else if (evidence.disposition !== 'enabled') {
      gaps.push({
        eventType: row.eventType,
        owner: 'NTF/source',
        code: 'event_not_enabled',
        detail: `${row.eventType}:v${evidence.version} is ${evidence.disposition}`,
      })
    } else if (
      !evidence.consumers.some(
        (consumer) =>
          consumer.name === row.consumerName &&
          consumer.kind === 'durable' &&
          consumer.disposition === 'enabled',
      )
    ) {
      gaps.push({
        eventType: row.eventType,
        owner: 'NTF/source',
        code: 'consumer_not_catalogued',
        detail: `${row.consumerName} is absent or inactive in the event catalogue`,
      })
    }
  }

  const gap = (
    requirement: BetaNotificationReadinessRequirement,
    code: BetaNotificationReadinessGap['code'],
    detail: string,
  ) =>
    gaps.push({
      eventType: requirement.eventType,
      owner: requirement.owner,
      code,
      detail,
    })

  for (const requirement of BETA_NOTIFICATION_READINESS_REQUIREMENTS) {
    const evidence = eventFamilies.find(
      (family) =>
        family.eventType === requirement.eventType &&
        family.version === requirement.version,
    )
    if (
      !evidence &&
      !gaps.some(
        (existing) =>
          existing.eventType === requirement.eventType &&
          existing.code === 'event_not_catalogued',
      )
    ) {
      gap(
        requirement,
        'event_not_catalogued',
        `${requirement.eventType}:v${requirement.version} is absent from the event catalogue`,
      )
    } else if (
      evidence &&
      !evidence.recordedInOutbox &&
      !gaps.some(
        (existing) =>
          existing.eventType === requirement.eventType &&
          existing.code === 'producer_not_durable',
      )
    ) {
      gap(
        requirement,
        'producer_not_durable',
        `${requirement.eventType}:v${requirement.version} is not recorded in the outbox`,
      )
    }

    const row = matrix.find((candidate) => candidate.eventType === requirement.eventType)
    if (
      'expectsNotification' in requirement &&
      requirement.expectsNotification === false
    ) {
      if (row) {
        gap(
          requirement,
          'unexpected_notification_trigger',
          `${requirement.eventType}:v${requirement.version} is evidence-only and must not notify`,
        )
      }
      continue
    }
    if (!row) {
      gap(
        requirement,
        'trigger_unmapped',
        `${requirement.eventType}:v${requirement.version} has no trigger/recipient row`,
      )
      continue
    }
    if (!registeredKeys.has(registrationKey(row))) {
      gap(
        requirement,
        'consumer_not_registered',
        `${row.consumerName} is not registered durably`,
      )
    }
    if (
      requirement.notificationType &&
      !row.notifications.some(
        (notification) => notification.type === requirement.notificationType,
      )
    ) {
      gap(
        requirement,
        'notification_type_unmapped',
        `${requirement.eventType} does not map ${requirement.notificationType}`,
      )
    }
    if (
      requirement.audienceKinds.some(
        (audienceKind) => !row.audienceKinds.includes(audienceKind),
      )
    ) {
      gap(
        requirement,
        'audience_policy_incomplete',
        `${requirement.eventType} does not declare every required audience policy`,
      )
    }
    if (
      'eventCondition' in requirement &&
      requirement.eventCondition &&
      row.eventCondition !== requirement.eventCondition
    ) {
      gap(
        requirement,
        'event_condition_incomplete',
        `${requirement.eventType} must apply ${requirement.eventCondition}`,
      )
    }
  }

  return {
    ready: structuralViolations.length === 0 && gaps.length === 0,
    structuralViolations,
    gaps,
  }
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
