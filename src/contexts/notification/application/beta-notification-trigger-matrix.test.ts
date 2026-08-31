import { describe, expect, it } from 'vitest'
import {
  BETA_DARK_NOTIFICATION_TYPES,
  BETA_NOTIFICATION_TRIGGER_MATRIX,
  betaNotificationReadinessReport,
  betaNotificationTriggerMatrixViolations,
  type BetaNotificationTriggerMatrixRow,
} from './beta-notification-trigger-matrix'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

const registered = BETA_NOTIFICATION_TRIGGER_MATRIX.map(
  ({ eventType, consumerName }) => ({ eventType, consumerName }),
)

describe('executable beta notification trigger matrix', () => {
  it('covers every implemented beta type with a durable trigger and derived category', () => {
    expect(betaNotificationTriggerMatrixViolations(registered)).toEqual([])
    expect(BETA_DARK_NOTIFICATION_TYPES).toEqual(['badge.awarded'])
  })

  it('proves Goal close/revision, resolution, material-revision, and reopen delivery', () => {
    const report = betaNotificationReadinessReport(registered, EVENT_FAMILY_ROWS)

    expect(report.ready).toBe(true)
    expect(report.structuralViolations).toEqual([])
    expect(report.gaps).toEqual([])
  })

  it('treats reconciled monthly results as durable evidence that must not notify', () => {
    const report = betaNotificationReadinessReport(registered, EVENT_FAMILY_ROWS, [
      ...BETA_NOTIFICATION_TRIGGER_MATRIX,
      {
        eventType: 'goal.monthly_result.reconciled',
        consumerName: 'notification.should-not-exist',
        notifications: [{ type: 'goal.completed', category: 'recognition' }],
        audienceKinds: ['responsible_scope'],
      },
    ])

    expect(report.gaps).toContainEqual(
      expect.objectContaining({
        eventType: 'goal.monthly_result.reconciled',
        code: 'unexpected_notification_trigger',
      }),
    )
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

  it('revalidates durable catalogue evidence for every active trigger family', () => {
    const eventFamilies = EVENT_FAMILY_ROWS.filter(
      (row) => row.eventType !== 'review.reply.published',
    )

    const report = betaNotificationReadinessReport(registered, eventFamilies)

    expect(report.gaps).toContainEqual(
      expect.objectContaining({
        eventType: 'review.reply.published',
        code: 'event_not_catalogued',
      }),
    )
  })

  it('fails when runtime registration exists but the durable catalogue route is inactive', () => {
    const eventFamilies = EVENT_FAMILY_ROWS.map((row) =>
      row.eventType === 'portal.health.changed'
        ? {
            ...row,
            consumers: row.consumers.filter(
              (consumer) => consumer.name !== 'notification.on-portal-health-changed',
            ),
          }
        : row,
    )

    const report = betaNotificationReadinessReport(registered, eventFamilies)

    expect(report.gaps).toContainEqual(
      expect.objectContaining({
        eventType: 'portal.health.changed',
        code: 'consumer_not_catalogued',
      }),
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
