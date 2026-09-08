import { describe, expect, it } from 'vitest'
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
})
