import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { registerAllEventSchemas } from './schema-registrations'
import { clearEventSchemas, validateEventPayload } from './schema-registry'

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
    ).toThrow()
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
    ).toThrow()
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
    ).toThrow()
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
