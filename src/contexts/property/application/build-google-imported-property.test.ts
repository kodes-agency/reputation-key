import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { buildGoogleImportedProperty } from './build-google-imported-property'

const NOW = new Date('2026-08-12T12:00:00.000Z')
const BASE_INPUT = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('00000000-0000-4000-8000-000000000001'),
  importItemId: '00000000-0000-4000-8000-000000000002',
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000003'),
  accountId: 'account-1',
  locationId: 'location-1',
  name: 'Acme Hotel',
  address: '1 Main Street',
  countryCode: 'US',
  timezone: 'America/New_York',
  confirmedBy: 'user-1',
  now: NOW,
} as const

describe('buildGoogleImportedProperty', () => {
  it('builds a deterministic tenant-confirmed active binding', () => {
    const property = buildGoogleImportedProperty(BASE_INPUT)

    expect(property).toMatchObject({
      id: BASE_INPUT.propertyId,
      organizationId: BASE_INPUT.organizationId,
      slug: `import-${BASE_INPUT.importItemId}`,
      gbpAccountId: BASE_INPUT.accountId,
      gbpLocationId: BASE_INPUT.locationId,
      googleConnectionId: BASE_INPUT.connectionId,
      googleBindingState: 'active',
      profileSource: 'tenant_confirmed',
      profileConfirmedAt: NOW,
      profileConfirmedBy: BASE_INPUT.confirmedBy,
      countryCode: 'US',
      countrySource: 'tenant_confirmed',
      timezoneSource: 'tenant_confirmed',
      timezoneResolvedAt: NOW,
      sourceEpoch: 0,
    })
  })

  it('rejects non-canonical provider resource names', () => {
    expect(() =>
      buildGoogleImportedProperty({
        ...BASE_INPUT,
        locationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      }),
    ).toThrow('canonical bare account/location suffixes')
  })
})
