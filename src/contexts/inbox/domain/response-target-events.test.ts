import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { inboxResponseTargetPolicyChanged } from './events'

const ORGANIZATION = organizationId('org-response-target-event')
const PROPERTY = propertyId('7b000000-0000-4000-8000-000000000001')
const USER = userId('user-response-target-event')
const OCCURRED_AT = new Date('2026-08-28T12:00:00.000Z')

describe('Response Target policy facts', () => {
  it('allows a disabled private-feedback Property override', () => {
    expect(
      inboxResponseTargetPolicyChanged({
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
        targetKind: 'private_feedback_handling',
        policyScope: 'property',
        durationMinutes: null,
        policyVersion: 2,
        userId: USER,
        occurredAt: OCCURRED_AT,
      }),
    ).toMatchObject({
      policyScope: 'property',
      durationMinutes: null,
      source: 'web',
    })
  })

  it('rejects a Google Property policy and a durationless Organization policy', () => {
    expect(() =>
      inboxResponseTargetPolicyChanged({
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
        targetKind: 'google_review_response',
        policyScope: 'property',
        durationMinutes: 2_880,
        policyVersion: 1,
        userId: USER,
        occurredAt: OCCURRED_AT,
      }),
    ).toThrow('Google Review Response Target has no Property policy scope')
    expect(() =>
      inboxResponseTargetPolicyChanged({
        organizationId: ORGANIZATION,
        propertyId: null,
        targetKind: 'private_feedback_handling',
        policyScope: 'organization',
        durationMinutes: null,
        policyVersion: 1,
        userId: USER,
        occurredAt: OCCURRED_AT,
      }),
    ).toThrow('Response Target policy duration is invalid')
  })
})
