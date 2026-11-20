import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'

describe('stored metric.recorded facts', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const payload = {
    readingId: 'reading-1',
    organizationId: 'organization-1',
    propertyId: 'property-1',
    portalId: null,
    portalGroupId: null,
    definitionVersionId: 'definition-1',
    sourceEventId: 'source-1',
    sourcePolicy: 'first_party_workflow',
    metricKey: 'portal.content_review.completed',
    value: 1,
    numerator: null,
    denominator: null,
    sampleCount: 1,
    attributionQuality: 'exact',
    permittedConsumers: ['dashboard'],
    occurredAt: '2026-08-08T12:00:00.000Z',
  }

  it.each([1, 2])('decodes version %i without retaining guest content', (version) => {
    const stored = version === 1 ? payload : { ...payload, staffAttribution: null }

    expect(
      validateEventPayload('metric.recorded', version, {
        ...stored,
        guestComment: 'private content',
      }),
    ).toEqual(stored)
  })
})
