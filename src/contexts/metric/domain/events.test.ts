import { describe, expect, it } from 'vitest'
import { metricRecorded } from './events'
import {
  metricReadingId,
  organizationId,
  portalGroupId,
  propertyId,
} from '#/shared/domain/ids'

describe('metricRecorded', () => {
  it('carries immutable provenance, event-time attribution, and consumer policy', () => {
    const event = metricRecorded({
      readingId: metricReadingId('d4000000-0000-4000-8000-000000000071'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('d4000000-0000-4000-8000-000000000051'),
      portalId: null,
      portalGroupId: portalGroupId('d4000000-0000-4000-8000-000000000061'),
      definitionVersionId: '11111111-1111-4111-8111-111111111101',
      sourceEventId: 'source-event-1',
      sourcePolicy: 'first_party_workflow',
      metricKey: 'portal.content_review.completed',
      value: 1,
      numerator: null,
      denominator: null,
      sampleCount: 1,
      attributionQuality: 'exact',
      permittedConsumers: ['dashboard', 'goal'],
      occurredAt: new Date('2026-08-08T12:00:00Z'),
    })

    expect(event).toMatchObject({
      _tag: 'metric.recorded',
      portalGroupId: 'd4000000-0000-4000-8000-000000000061',
      definitionVersionId: '11111111-1111-4111-8111-111111111101',
      sourceEventId: 'source-event-1',
      permittedConsumers: ['dashboard', 'goal'],
    })
  })
})
