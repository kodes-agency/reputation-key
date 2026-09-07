import { describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  recentActivityEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createProjectableRecentActivityReplayFact } from './recent-activity-replay-fact'

const event: ConsumerEvent = {
  eventId: '00000000-0000-4000-8000-000000000701',
  eventType: 'property.archived',
  eventVersion: 1,
  payload: {},
  organizationId: 'org-activity-replay',
  propertyId: '00000000-0000-4000-8000-000000000702',
  sourceContext: 'property',
  sourceAggregateId: '00000000-0000-4000-8000-000000000702',
  occurredAt: '2026-08-28T10:00:00.000Z',
  recordedAt: '2026-08-28T10:00:01.000Z',
}

const input = {
  action: 'changed' as const,
  resourceType: 'property' as const,
  resourceId: '00000000-0000-4000-8000-000000000702',
  propertyId: propertyId('00000000-0000-4000-8000-000000000702'),
  organizationId: organizationId('org-activity-replay'),
  userId: userId('user-activity-replay'),
  source: 'web' as const,
  eventId: event.eventId,
  occurredAt: new Date('2026-08-28T10:00:00.000Z'),
  payload: { subject: 'property', from: 'active', to: 'archived', detail: null },
}

describe('Recent Activity replay fact', () => {
  it('preserves source identity/version and only the canonical projection input', () => {
    const fact = createProjectableRecentActivityReplayFact(
      event,
      input,
      recentActivityEntryId('00000000-0000-4000-8000-000000000703'),
    )

    expect(fact).toMatchObject({
      replayKey: `event:${event.organizationId}:${event.eventId}`,
      sourceKind: 'durable_fact',
      sourceEventId: event.eventId,
      sourceEventType: 'property.archived',
      sourceEventVersion: 1,
      sourceContext: 'property',
      sourceAggregateId: event.sourceAggregateId,
      actorSubjectId: input.userId,
      actorLabelRedactedAt: null,
      payload: { subject: 'property', from: 'active', to: 'archived', detail: null },
    })
    expect(fact).toMatchObject({
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      propertyId: input.propertyId,
      organizationId: input.organizationId,
      actorSubjectId: input.userId,
      source: input.source,
      sourceOccurredAt: input.occurredAt,
      payload: input.payload,
    })
  })

  it('rejects content-like transition values before durable capture', () => {
    expect(() =>
      createProjectableRecentActivityReplayFact(
        event,
        {
          ...input,
          payload: {
            subject: 'property',
            from: 'active',
            to: 'archived',
            detail: 'private@example.test',
          },
        },
        recentActivityEntryId('00000000-0000-4000-8000-000000000703'),
      ),
    ).toThrow(/content-free/i)
  })
})
