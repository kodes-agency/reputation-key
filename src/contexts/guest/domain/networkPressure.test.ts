import { describe, expect, it } from 'vitest'
import {
  GUEST_NETWORK_PRESSURE_ACTIONS,
  createGuestNetworkPressureRecord,
} from './networkPressure'

const OBSERVED_AT = new Date('2026-08-27T23:59:59.000Z')

describe('Guest network pressure', () => {
  it('creates only the four content-free public-action records with an exact seven-day deadline', () => {
    expect(GUEST_NETWORK_PRESSURE_ACTIONS).toEqual([
      'rating',
      'private_feedback',
      'destination_action',
      'qualified_scan',
    ])

    for (const action of GUEST_NETWORK_PRESSURE_ACTIONS) {
      expect(
        createGuestNetworkPressureRecord({
          id: '82000000-0000-4000-8000-000000000001',
          organizationId: 'org-network-pressure',
          propertyId: '82000000-0000-4000-8000-000000000002',
          portalId: '82000000-0000-4000-8000-000000000003',
          pseudonym: 'a'.repeat(64),
          action,
          observedAt: OBSERVED_AT,
        })._unsafeUnwrap(),
      ).toEqual({
        id: '82000000-0000-4000-8000-000000000001',
        organizationId: 'org-network-pressure',
        propertyId: '82000000-0000-4000-8000-000000000002',
        portalId: '82000000-0000-4000-8000-000000000003',
        pseudonym: 'a'.repeat(64),
        action,
        observedAt: OBSERVED_AT,
        expiresAt: new Date('2026-09-03T23:59:59.000Z'),
      })
    }
  })

  it('rejects values that could become raw addresses, content, or unscoped identities', () => {
    const valid = {
      id: '82000000-0000-4000-8000-000000000001',
      organizationId: 'org-network-pressure',
      propertyId: '82000000-0000-4000-8000-000000000002',
      portalId: '82000000-0000-4000-8000-000000000003',
      pseudonym: 'a'.repeat(64),
      action: 'rating' as const,
      observedAt: OBSERVED_AT,
    }

    const invalid = [
      createGuestNetworkPressureRecord({
        ...valid,
        pseudonym: '203.0.113.20',
      }),
      createGuestNetworkPressureRecord({ ...valid, organizationId: ' ' }),
      createGuestNetworkPressureRecord({ ...valid, portalId: '' }),
      createGuestNetworkPressureRecord({
        ...valid,
        observedAt: new Date('invalid'),
      }),
      createGuestNetworkPressureRecord({
        ...valid,
        action: 'identity_probe' as never,
      }),
    ]

    expect(invalid.map((result) => result._unsafeUnwrapErr().message)).toEqual([
      expect.stringContaining('pseudonym'),
      expect.stringContaining('Organization'),
      expect.stringContaining('Portal'),
      expect.stringContaining('time'),
      expect.stringContaining('action'),
    ])
  })
})
