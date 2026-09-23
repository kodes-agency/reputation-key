import { describe, expect, it } from 'vitest'
import {
  classifyNotification,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_SETTINGS_CATEGORIES,
  ORGANIZATION_INFORMATIONAL_TYPES,
} from '../domain/notification-delivery-policy'
import type { NotificationType } from '../domain/notification-types'
import {
  BETA_DARK_NOTIFICATION_TYPES,
  BETA_NOTIFICATION_TRIGGER_MATRIX,
  betaNotificationTriggerMatrixViolations,
  type BetaNotificationTriggerMatrixRow,
} from './beta-notification-trigger-matrix'

const registered = BETA_NOTIFICATION_TRIGGER_MATRIX.map(
  ({ eventType, consumerName }) => ({ eventType, consumerName }),
)

describe('executable beta notification trigger matrix', () => {
  it('covers every implemented beta type with a durable trigger and derived category', () => {
    expect(betaNotificationTriggerMatrixViolations(registered)).toEqual([])
    expect(BETA_DARK_NOTIFICATION_TYPES).toEqual([])
  })

  it('fails when a real notification trigger loses durable registration', () => {
    const withoutBulk = registered.filter(
      (consumer) => consumer.eventType !== 'inbox.inbox_items.bulk_assignment_completed',
    )

    expect(betaNotificationTriggerMatrixViolations(withoutBulk)).toContain(
      'missing durable notification consumer notification.on-inbox-bulk-assignment-completed for inbox.inbox_items.bulk_assignment_completed',
    )
  })

  it('does not exempt formerly incomplete families after their trigger facts exist', () => {
    const withoutGoal = BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
      (row) => row.eventType !== 'goal.monthly_result.closed',
    )
    const registrations = withoutGoal.map(({ eventType, consumerName }) => ({
      eventType,
      consumerName,
    }))

    expect(betaNotificationTriggerMatrixViolations(registrations, withoutGoal)).toContain(
      'active beta notification type goal.completed has 0 trigger mappings',
    )
  })

  it('fails for an unmapped notification type or audience policy', () => {
    const inboxCreated = BETA_NOTIFICATION_TRIGGER_MATRIX.find(
      (row) => row.eventType === 'inbox.inbox_item.created',
    )!
    const invalid: BetaNotificationTriggerMatrixRow = {
      ...inboxCreated,
      notifications: [{ type: 'review.unmapped', category: 'workflow_collaboration' }],
      audienceKinds: ['arbitrary_team'],
    }
    const matrix = BETA_NOTIFICATION_TRIGGER_MATRIX.map((row) =>
      row.eventType === 'inbox.inbox_item.created' ? invalid : row,
    )
    const violations = betaNotificationTriggerMatrixViolations(registered, matrix)

    expect(violations).toContain(
      'notification trigger inbox.inbox_item.created maps unknown type review.unmapped',
    )
    expect(violations).toContain(
      'notification trigger inbox.inbox_item.created maps unknown audience arbitrary_team',
    )
    expect(violations).toContain(
      'active beta notification type review.created has 0 trigger mappings',
    )
  })

  it('fails when a durable notification consumer is absent from policy', () => {
    expect(
      betaNotificationTriggerMatrixViolations([
        ...registered,
        {
          eventType: 'inbox.unmapped',
          consumerName: 'notification.on-unmapped',
        },
      ]),
    ).toContain(
      'durable notification consumer notification.on-unmapped for inbox.unmapped is absent from the beta matrix',
    )
  })

  it('fails when a settling route is registered but absent from policy', () => {
    expect(
      betaNotificationTriggerMatrixViolations([
        ...registered,
        {
          eventType: 'inbox.handling_cycle.closed',
          consumerName: 'notification.settle-on-unmapped',
        },
      ]),
    ).toContain(
      'durable notification consumer notification.settle-on-unmapped for inbox.handling_cycle.closed is absent from the beta matrix',
    )
  })

  it('fails when a route neither announces nor settles anything', () => {
    const silent: BetaNotificationTriggerMatrixRow = {
      eventType: 'inbox.nothing_happens',
      consumerName: 'notification.on-nothing',
      notifications: [],
      audienceKinds: [],
    }

    expect(
      betaNotificationTriggerMatrixViolations(
        [
          ...registered,
          { eventType: silent.eventType, consumerName: silent.consumerName },
        ],
        [...BETA_NOTIFICATION_TRIGGER_MATRIX, silent],
      ),
    ).toContain('notification trigger inbox.nothing_happens maps no notification type')
  })

  it('refuses a settling route that claims to retire a notice nobody waits on', () => {
    const wrong: BetaNotificationTriggerMatrixRow = {
      eventType: 'review.reply.approved',
      consumerName: 'notification.settle-on-review-reply-approved',
      notifications: [],
      audienceKinds: [],
      settles: ['reply.approved'],
    }
    const matrix = BETA_NOTIFICATION_TRIGGER_MATRIX.map((row) =>
      row.consumerName === wrong.consumerName ? wrong : row,
    )

    expect(betaNotificationTriggerMatrixViolations(registered, matrix)).toContain(
      'notification trigger review.reply.approved settles reply.approved, which asks its reader for nothing',
    )
  })

  it('does not let a settled type stand in for the trigger that announces it', () => {
    const liveTypes = BETA_NOTIFICATION_TRIGGER_MATRIX.flatMap((row) =>
      row.notifications.map((policy) => policy.type),
    )

    expect(liveTypes.filter((type) => type === 'reply.pending_approval')).toHaveLength(1)
  })

  // The reverse of the policy's "every advertised category governs a type".
  // A live notice in a category with no control can be neither muted, nor
  // filtered to, nor opted in to email: that is how goal results sat under a
  // hidden `recognition` category while a monthly burst of them went out.
  it('gives every live notification type a setting or a fixed policy, and a filter', () => {
    const liveTypes = BETA_NOTIFICATION_TRIGGER_MATRIX.flatMap((row) =>
      row.notifications.map((policy) => policy.type as NotificationType),
    )

    for (const type of liveTypes) {
      const category = classifyNotification(type)
      const controlled =
        category === 'mandatory' ||
        ORGANIZATION_INFORMATIONAL_TYPES.has(type) ||
        (NOTIFICATION_SETTINGS_CATEGORIES as readonly string[]).includes(category)
      expect(
        controlled,
        `${type} is live in ${category}, which is neither configurable, mandatory, nor Organization-informational`,
      ).toBe(true)
      expect(
        GOVERNING_NOTIFICATION_CATEGORIES.includes(category),
        `${type} is live in ${category}, which has no filter`,
      ).toBe(true)
    }
  })
})
