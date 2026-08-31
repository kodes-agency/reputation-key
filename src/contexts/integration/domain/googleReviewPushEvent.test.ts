import { describe, expect, it } from 'vitest'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { integrationGoogleReviewPushAccepted } from './events'

describe('integration.google_review_push.accepted', () => {
  it('serializes only routing identifiers and the opaque target reference', () => {
    registerAllEventSchemas()
    const event = integrationGoogleReviewPushAccepted({
      organizationId: organizationId('org-google-push'),
      propertyId: '00000000-0000-4000-8000-000000000001',
      connectionId: googleConnectionId('00000000-0000-4000-8000-000000000002'),
      sourceEpoch: 3,
      referenceRef: `v1.${Buffer.alloc(32, 9).toString('base64url')}`,
      notificationKind: 'NEW_REVIEW',
      occurredAt: new Date('2026-08-27T08:00:00.000Z'),
    })

    const serialized = toOutboxEvent(event)
    expect(serialized.eventType).toBe('integration.google_review_push.accepted')
    expect(serialized.payload).toEqual({
      organizationId: 'org-google-push',
      propertyId: '00000000-0000-4000-8000-000000000001',
      connectionId: '00000000-0000-4000-8000-000000000002',
      sourceEpoch: 3,
      referenceRef: `v1.${Buffer.alloc(32, 9).toString('base64url')}`,
      notificationKind: 'NEW_REVIEW',
      occurredAt: '2026-08-27T08:00:00.000Z',
      correlationId: null,
    })
    expect(JSON.stringify(serialized)).not.toContain('accounts/')
  })
})
