import { describe, expect, it } from 'vitest'
import { inboxItemId } from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience.server'
import {
  HEALTH_SINCE,
  INBOX_ITEM,
  PORTAL,
  PROPERTY,
  RESOLVED_AT,
  SECOND_INBOX_ITEM,
  TARGET_SCHEDULED_FOR,
} from './notification-audience.test-fixtures'

const expectOnlyValid = (valid: unknown, rejectedVariants: readonly unknown[]) => {
  expect(parseNotificationAudience(valid)).toEqual(valid)
  for (const variant of rejectedVariants) {
    expect(parseNotificationAudience(variant)).toBeNull()
  }
}

describe('notification audience authorization', () => {
  it('rejects unsupported or partial affected-user audience descriptors', () => {
    const descriptor = {
      kind: 'affected_organization_user',
      eventId: 'identity-event-1',
      eventType: 'identity.member.removed',
    }
    expectOnlyValid(descriptor, [
      { ...descriptor, eventType: 'identity.member.invited' },
      { ...descriptor, eventId: '' },
    ])
  })

  describe('a request to choose a responsible manager', () => {
    const propertyGap = {
      kind: 'responsibility_gap' as const,
      scope: { kind: 'property' as const, propertyId: PROPERTY },
    }
    const portalGap = {
      kind: 'responsibility_gap' as const,
      scope: { kind: 'portal' as const, portalId: PORTAL },
    }

    it('parses only a Property or Portal gap', () => {
      expect(parseNotificationAudience(portalGap)).toEqual(portalGap)
      expectOnlyValid(propertyGap, [
        {
          kind: 'responsibility_gap',
          scope: { kind: 'portal_group', portalGroupId: 'group-1' },
        },
        { kind: 'responsibility_gap', scope: { kind: 'property', propertyId: '' } },
      ])
    })
  })

  it('parses a bounded unique grouped audience and rejects duplicates', () => {
    expectOnlyValid(
      { kind: 'bulk_inbox_assignee', inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM] },
      [{ kind: 'bulk_inbox_assignee', inboxItemIds: [INBOX_ITEM, INBOX_ITEM] }],
    )
  })

  it('parses only a complete canonical escalation-resolution audience', () => {
    const valid = {
      kind: 'escalation_resolution',
      inboxItemId: INBOX_ITEM,
      resolvedAt: RESOLVED_AT,
      resolvedBy: 'resolver-1',
    }
    expectOnlyValid(valid, [{ ...valid, resolvedAt: 'not-a-date', resolvedBy: null }])
  })

  it('parses only a complete positive Handling Cycle audience', () => {
    const valid = {
      kind: 'handling_cycle',
      inboxItemId: INBOX_ITEM,
      sourceType: 'review',
      sourceId: 'review-source-1',
      cycleNumber: 2,
      sourceRevision: 2,
      stateRevision: 3,
      actorUserId: null,
    }
    expectOnlyValid(valid, [
      { ...valid, stateRevision: 0 },
      { ...valid, sourceType: 'unknown' },
      { ...valid, actorUserId: '' },
    ])
  })

  describe('a grouped bulk reopen', () => {
    const cycle = (item: typeof INBOX_ITEM) => ({
      inboxItemId: item,
      sourceType: 'review' as const,
      sourceId: `review-${item}`,
      cycleNumber: 2,
      sourceRevision: 1,
      stateRevision: 3,
    })
    const audience = {
      kind: 'bulk_handling_cycle' as const,
      cycles: [cycle(INBOX_ITEM), cycle(SECOND_INBOX_ITEM)],
      actorUserId: 'bulk-actor',
    }

    it('parses only a bounded, unique, complete list of cycles', () => {
      expectOnlyValid(audience, [
        { ...audience, cycles: [] },
        { ...audience, cycles: [cycle(INBOX_ITEM), cycle(INBOX_ITEM)] },
        { ...audience, cycles: [{ ...cycle(INBOX_ITEM), cycleNumber: 0 }] },
        {
          ...audience,
          cycles: Array.from({ length: 101 }, (_, index) =>
            cycle(inboxItemId(`item-${index}`)),
          ),
        },
        { ...audience, actorUserId: '' },
      ])
    })
  })

  it('parses only a complete Response Target reminder audience', () => {
    const valid = {
      kind: 'response_target_reminder',
      inboxItemId: INBOX_ITEM,
      sourceType: 'review',
      sourceId: 'review-source-1',
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: 1,
      targetKind: 'google_review_response',
      reminderKind: 'target_passed',
      scheduledFor: TARGET_SCHEDULED_FOR,
    }
    expectOnlyValid(valid, [
      { ...valid, cycleNumber: 0 },
      { ...valid, targetKind: 'unknown' },
      { ...valid, reminderKind: 'daily' },
      { ...valid, scheduledFor: 'not-a-date' },
    ])
  })

  it('parses only actionable exact-state Portal Health audiences', () => {
    const valid = {
      kind: 'portal_health',
      portalId: PORTAL,
      status: 'unavailable',
      reason: 'public_address_unavailable',
      effectiveFrom: HEALTH_SINCE,
    }
    expectOnlyValid(valid, [
      { ...valid, status: 'healthy' },
      { ...valid, reason: 'publication_draft' },
      { ...valid, effectiveFrom: 'yesterday' },
    ])
  })

  it('parses only complete Goal completion audiences', () => {
    const valid = {
      kind: 'goal_completion',
      programId: 'program-1',
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
    }
    expectOnlyValid(valid, [
      { ...valid, monthlyResultId: '' },
      { ...valid, programId: undefined },
    ])
  })

  it('parses only complete, internally consistent Goal revision audiences', () => {
    const valid = {
      kind: 'goal_result_revision',
      programId: 'program-1',
      programVersionId: 'program-version-2',
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
      revisionId: 'revision-2',
      revision: 2,
      evaluationState: 'unavailable',
      achieved: null,
    }
    expectOnlyValid(valid, [
      { ...valid, revision: 0 },
      { ...valid, evaluationState: 'eligible' },
      { ...valid, revisionId: '' },
    ])
  })
})
