import { GOOGLE_ACCOUNT_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_BINDING_STATES,
  isGoogleBindingTupleValid,
  isGoogleResourceSuffix,
} from './google-binding-contract'
import { validateEventPayload } from '#/shared/events/schema-registry'

describe('Property Google binding contract', () => {
  it('freezes the four-state lifecycle', () => {
    expect(GOOGLE_BINDING_STATES).toEqual([
      'unbound',
      'account_confirmation_required',
      'active',
      'disconnected',
    ])
  })

  it('accepts only bare bounded provider suffixes', () => {
    expect(isGoogleResourceSuffix('123456789')).toBe(true)
    expect(isGoogleResourceSuffix('x'.repeat(255))).toBe(true)
    for (const value of [
      '',
      GOOGLE_ACCOUNT_PRIMARY_RESOURCE,
      'a?b',
      'a#b',
      'a b',
      'x'.repeat(256),
    ]) {
      expect(isGoogleResourceSuffix(value)).toBe(false)
    }
  })

  it('enforces the exact tuple required by each binding state', () => {
    const connectionId = 'connection-1' as never
    expect(
      isGoogleBindingTupleValid({
        state: 'unbound',
        connectionId: null,
        accountId: null,
        locationId: null,
      }),
    ).toBe(true)
    expect(
      isGoogleBindingTupleValid({
        state: 'account_confirmation_required',
        connectionId,
        accountId: null,
        locationId: 'location-1',
      }),
    ).toBe(true)
    expect(
      isGoogleBindingTupleValid({
        state: 'active',
        connectionId,
        accountId: 'account-1',
        locationId: 'location-1',
      }),
    ).toBe(true)
    expect(
      isGoogleBindingTupleValid({
        state: 'active',
        connectionId,
        accountId: null,
        locationId: 'location-1',
      }),
    ).toBe(false)
  })

  it('registers strict identifier-only binding and retention event payloads', () => {
    const binding = {
      organizationId: 'org-1',
      propertyId: 'property-1',
      connectionId: 'connection-1',
      sourceEpoch: 2,
      change: 'relinked',
    }
    expect(() =>
      validateEventPayload('property.google_binding.changed', 1, binding),
    ).not.toThrow()
    expect(() =>
      validateEventPayload('property.google_binding.changed', 1, {
        ...binding,
        accountId: 'provider-account',
      }),
    ).toThrow(/accountId/)

    const retention = {
      organizationId: 'org-1',
      idempotencyKeys: ['00000000-0000-4000-8000-000000000001'],
    }
    expect(() =>
      validateEventPayload(
        'integration.property_import.retention_released',
        1,
        retention,
      ),
    ).not.toThrow()
    expect(() =>
      validateEventPayload('integration.property_import.retention_released', 1, {
        ...retention,
        idempotencyKeys: Array.from(
          { length: 101 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
      }),
    ).toThrow(/100/)
  })
})
