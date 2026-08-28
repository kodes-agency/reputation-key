import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { registerAllEventSchemas } from './schema-registrations'
import { clearEventSchemas, validateEventPayload } from './schema-registry'

describe('registered Portal semantic lifecycle schemas', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const lifecycle = {
    organizationId: 'organization-1',
    propertyId: '22222222-2222-4222-8222-222222222222',
    portalId: '33333333-3333-4333-8333-333333333333',
    userId: 'manager-1',
    sourceAggregateVersion: '2026-08-26T12:01:00.000Z',
    occurredAt: '2026-08-26T12:00:00.000Z',
  } as const
  const publication = {
    ...lifecycle,
    publicationSnapshotId: '44444444-4444-4444-8444-444444444444',
    publicationVersion: 3,
    publicationDigest: 'a'.repeat(64),
  }

  it.each([
    ['portal.publication.published', publication],
    ['portal.publication.rolled_back', publication],
    ['portal.archived', lifecycle],
    ['portal.restored', lifecycle],
  ] as const)('retains only the content-minimal %s payload', (type, payload) => {
    expect(
      validateEventPayload(type, 1, {
        ...payload,
        name: 'must not enter the durable fact',
        destinationUri: 'https://example.com/private-target',
      }),
    ).toEqual(payload)
  })

  it.each([
    ['zero publication version', { publicationVersion: 0 }],
    ['invalid publication digest', { publicationDigest: 'not-a-digest' }],
    ['invalid occurrence time', { occurredAt: 'not-a-time' }],
  ])('rejects publication evidence with %s', (_label, override) => {
    expect(() =>
      validateEventPayload('portal.publication.published', 1, {
        ...publication,
        ...override,
      }),
    ).toThrowError(ZodError)
  })
})

const baseObservedPayload = {
  reviewId: '11111111-1111-4111-8111-111111111111',
  organizationId: 'organization-1',
  propertyId: '22222222-2222-4222-8222-222222222222',
  observationRevision: 2,
  sourceEpoch: 1,
  materialReviewRevision: 3,
  change: 'edited',
  resolution: 'diverged',
  provenance: 'external_or_unknown',
  matchedReplyId: null,
  matchedPublicationCycle: null,
  occurredAt: '2026-08-16T12:00:00.000Z',
} as const

describe('registered review.reply.observed schema', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it.each([
    {
      name: 'confirmed resolution without RepKey provenance',
      override: {
        change: 'added',
        resolution: 'confirmed_on_google',
        provenance: 'external_or_unknown',
        matchedReplyId: '33333333-3333-4333-8333-333333333333',
        matchedPublicationCycle: 1,
      },
    },
    {
      name: 'confirmed resolution without an exact Reply match',
      override: {
        change: 'added',
        resolution: 'confirmed_on_google',
        provenance: 'repkey_confirmed',
        matchedReplyId: null,
        matchedPublicationCycle: null,
      },
    },
    {
      name: 'divergence carrying RepKey provenance and a match',
      override: {
        resolution: 'diverged',
        provenance: 'repkey_confirmed',
        matchedReplyId: '33333333-3333-4333-8333-333333333333',
        matchedPublicationCycle: 1,
      },
    },
    {
      name: 'absence without a deletion',
      override: {
        change: 'added',
        resolution: 'absent',
        provenance: 'none',
      },
    },
  ])('rejects semantically impossible payload: $name', ({ override }) => {
    expect(() =>
      validateEventPayload('review.reply.observed', 1, {
        ...baseObservedPayload,
        ...override,
      }),
    ).toThrowError(ZodError)
  })

  it('accepts an externally edited current-live reply', () => {
    expect(() =>
      validateEventPayload('review.reply.observed', 1, {
        ...baseObservedPayload,
        change: 'edited',
        resolution: 'external_current_live',
      }),
    ).not.toThrow()
  })

  it('accepts an unchanged external-current-live head for a newer attempt', () => {
    expect(() =>
      validateEventPayload('review.reply.observed', 1, {
        ...baseObservedPayload,
        change: 'unchanged',
        resolution: 'external_current_live',
      }),
    ).not.toThrow()
  })

  it.each([
    ['empty organization', { organizationId: '' }],
    ['non-UUID Review', { reviewId: 'review-1' }],
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['invalid timestamp', { occurredAt: 'not-a-timestamp' }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      validateEventPayload('review.reply.observed', 1, {
        ...baseObservedPayload,
        ...override,
      }),
    ).toThrowError(ZodError)
  })
})

describe('registered review.reply.publication_cancelled schema', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const validPayload = {
    replyId: '33333333-3333-4333-8333-333333333333',
    reviewId: '11111111-1111-4111-8111-111111111111',
    organizationId: 'organization-1',
    propertyId: '22222222-2222-4222-8222-222222222222',
    cause: 'provider_truth',
    occurredAt: '2026-08-16T12:00:00.000Z',
  }

  it('accepts the exact identifier-only cancellation fact', () => {
    expect(() =>
      validateEventPayload('review.reply.publication_cancelled', 1, validPayload),
    ).not.toThrow()
  })

  it.each([
    ['empty organization', { organizationId: '' }],
    ['non-UUID Reply', { replyId: 'reply-1' }],
    ['non-UUID Review', { reviewId: 'review-1' }],
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['invalid cause', { cause: 'unknown' }],
    ['invalid timestamp', { occurredAt: 'not-a-timestamp' }],
    ['missing timestamp', { occurredAt: undefined }],
  ])('rejects cancellation with %s', (_name, override) => {
    expect(() =>
      validateEventPayload('review.reply.publication_cancelled', 1, {
        ...validPayload,
        ...override,
      }),
    ).toThrowError(ZodError)
  })
})

describe('registered Goal monthly-result schemas', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const validClosedPayload = {
    organizationId: 'organization-1',
    propertyId: '10000000-0000-4000-8000-000000000002',
    programId: '10000000-0000-4000-8000-000000000003',
    programVersionId: '10000000-0000-4000-8000-000000000004',
    assignmentId: '10000000-0000-4000-8000-000000000005',
    monthlyResultId: '10000000-0000-4000-8000-000000000006',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    status: 'closed',
    evaluationState: 'eligible',
    achieved: true,
    occurredAt: '2026-08-02T12:00:00.000Z',
  } as const

  it('accepts exact achieved and non-achieved closed facts', () => {
    expect(
      validateEventPayload('goal.monthly_result.closed', 1, validClosedPayload),
    ).toEqual(validClosedPayload)
    expect(() =>
      validateEventPayload('goal.monthly_result.closed', 1, {
        ...validClosedPayload,
        evaluationState: 'unavailable',
        achieved: null,
      }),
    ).not.toThrow()
  })

  it('replays the pre-adapter v1 payload using tenant scope from its envelope', () => {
    const {
      organizationId: _organizationId,
      propertyId: _propertyId,
      occurredAt: _occurredAt,
      ...legacyPayload
    } = validClosedPayload
    expect(validateEventPayload('goal.monthly_result.closed', 1, legacyPayload)).toEqual(
      legacyPayload,
    )
  })

  it.each([
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['non-UUID assignment', { assignmentId: 'assignment-1' }],
    ['invalid period start', { periodStart: 'not-a-timestamp' }],
    ['wrong status', { status: 'reconciling' }],
    ['eligible without a decision', { achieved: null }],
    ['non-eligible with a decision', { evaluationState: 'unavailable', achieved: false }],
    ['still updating', { evaluationState: 'updating', achieved: null }],
  ])('rejects a closed fact with %s', (_name, override) => {
    expect(() =>
      validateEventPayload('goal.monthly_result.closed', 1, {
        ...validClosedPayload,
        ...override,
      }),
    ).toThrowError(ZodError)
  })

  it('accepts the exact reconciling shape and rejects a closed status', () => {
    const payload = {
      ...validClosedPayload,
      status: 'reconciling',
      evaluationState: 'updating',
      achieved: null,
    }
    expect(validateEventPayload('goal.monthly_result.reconciled', 1, payload)).toEqual(
      payload,
    )
    expect(() =>
      validateEventPayload('goal.monthly_result.reconciled', 1, {
        ...payload,
        status: 'closed',
      }),
    ).toThrowError(ZodError)
  })
})

describe('registered review.reply.publication_requested schemas', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  const validV2Payload = {
    replyId: '33333333-3333-4333-8333-333333333333',
    reviewId: '11111111-1111-4111-8111-111111111111',
    organizationId: 'organization-1',
    propertyId: '22222222-2222-4222-8222-222222222222',
    userId: 'user-1',
    publicationCycle: 1,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    baseObservationRevision: 0,
    occurredAt: '2026-08-16T12:00:00.000Z',
  } as const

  it('retains the permissive v1 decoder for historical replay', () => {
    expect(() =>
      validateEventPayload('review.reply.publication_requested', 1, {
        replyId: 'legacy-reply',
        reviewId: 'legacy-review',
        organizationId: 'legacy-organization',
        propertyId: 'legacy-property',
        userId: 'legacy-user',
        publicationCycle: 1,
        occurredAt: 'legacy-timestamp',
      }),
    ).not.toThrow()
  })

  it('accepts the exact identifier-only v2 publication intent', () => {
    expect(() =>
      validateEventPayload('review.reply.publication_requested', 2, validV2Payload),
    ).not.toThrow()
  })

  it.each([
    ['non-UUID Reply', { replyId: 'reply-1' }],
    ['non-UUID Review', { reviewId: 'review-1' }],
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['empty Organization', { organizationId: '  ' }],
    ['empty authorizing user', { userId: '' }],
    ['invalid occurrence timestamp', { occurredAt: 'not-a-timestamp' }],
  ])('rejects v2 publication intent with %s', (_name, override) => {
    expect(() =>
      validateEventPayload('review.reply.publication_requested', 2, {
        ...validV2Payload,
        ...override,
      }),
    ).toThrow(ZodError)
  })
})
