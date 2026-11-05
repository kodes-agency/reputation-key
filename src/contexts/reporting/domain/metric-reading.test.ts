import { describe, expect, it } from 'vitest'
import { createReading } from './metric-reading'
import { metricReadingId, organizationId, propertyId } from '#/shared/domain/ids'

const NOW = new Date('2026-01-16T00:00:00Z')

const makeReadingParams = (
  overrides: Partial<Parameters<typeof createReading>[0]> = {},
): Parameters<typeof createReading>[0] => ({
  id: metricReadingId('d4000000-0000-4000-8000-000000000071'),
  definitionVersionId: 'ver-1',
  metricKey: 'portal.content_review.completed',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('d4000000-0000-4000-8000-000000000051'),
  value: 42,
  sampleCount: 10,
  sourceEventId: 'evt-1',
  sourcePolicy: 'first_party_workflow',
  occurredAt: new Date('2026-01-15T00:00:00Z'),
  propertyLocalDate: '2026-01-15',
  attributionQuality: 'exact',
  retentionClass: 'standard',
  now: NOW,
  ...overrides,
})

describe('MetricReading', () => {
  it('creates a provenance-complete reading', () => {
    const reading = createReading(makeReadingParams())
    expect(reading).toMatchObject({
      value: 42,
      recordedAt: NOW,
      sampleCount: 10,
      sourcePolicy: 'first_party_workflow',
    })
  })
})
