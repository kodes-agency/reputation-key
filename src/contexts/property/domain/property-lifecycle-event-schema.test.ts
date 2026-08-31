import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

const lifecyclePayload = {
  propertyId: 'f5000000-0000-4000-8000-000000000001',
  organizationId: 'organization-1',
  userId: 'admin-1',
  previousState: 'active',
  sourceEpoch: 8,
  occurredAt: '2026-08-28T12:00:00.000Z',
} as const

describe('registered Property lifecycle fact schemas', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('keeps archive facts identifier-only and drops accidental content', () => {
    expect(
      validateEventPayload('property.archived', 1, {
        ...lifecyclePayload,
        recoveryDeadline: '2026-09-27T12:00:00.000Z',
        archiveReason: 'must remain in Property state, not the durable fact',
        googleReviewUri: 'https://example.com/not-fact-content',
      }),
    ).toEqual({
      ...lifecyclePayload,
      recoveryDeadline: '2026-09-27T12:00:00.000Z',
    })
  })

  it('rejects an archive fact whose recovery deadline is not after archive time', () => {
    expect(() =>
      validateEventPayload('property.archived', 1, {
        ...lifecyclePayload,
        recoveryDeadline: lifecyclePayload.occurredAt,
      }),
    ).toThrowError(ZodError)
    expect(() =>
      validateEventPayload('property.archived', 1, {
        ...lifecyclePayload,
        previousState: 'archived',
        recoveryDeadline: '2026-09-27T12:00:00.000Z',
      }),
    ).toThrowError(ZodError)
  })

  it('accepts only explicit reconnect readiness on restored facts', () => {
    expect(
      validateEventPayload('property.restored', 1, {
        ...lifecyclePayload,
        previousState: 'archived',
        googleBindingReadiness: 'reconnect_required',
        providerCredential: 'must not enter the durable fact',
      }),
    ).toEqual({
      ...lifecyclePayload,
      previousState: 'archived',
      googleBindingReadiness: 'reconnect_required',
    })
    expect(() =>
      validateEventPayload('property.restored', 1, {
        ...lifecyclePayload,
        previousState: 'archived',
        googleBindingReadiness: 'unknown',
      }),
    ).toThrowError(ZodError)
  })

  it.each([
    ['empty Organization', { organizationId: '' }],
    ['non-UUID Property', { propertyId: 'property-1' }],
    ['empty actor', { userId: '' }],
    ['non-positive authority epoch', { sourceEpoch: 0 }],
    ['invalid occurrence time', { occurredAt: 'not-a-timestamp' }],
  ])('rejects lifecycle attribution with %s', (_name, override) => {
    expect(() =>
      validateEventPayload('property.restored', 1, {
        ...lifecyclePayload,
        previousState: 'archived',
        googleBindingReadiness: 'ready',
        ...override,
      }),
    ).toThrowError(ZodError)
  })
})
