import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { buildProperty } from '../domain/constructors'
import type { Property } from '../domain/types'

export type BuildGoogleImportedPropertyInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  importItemId: string
  connectionId: GoogleConnectionId
  accountId: string
  locationId: string
  name: string
  address: string | null
  countryCode: string
  timezone: string
  confirmedBy: string
  now: Date
}>

/**
 * Builds the tenant-confirmed Property mutation consumed by the binding store.
 * The import item ID gives create retries one deterministic, provider-free slug.
 */
export function buildGoogleImportedProperty(
  input: BuildGoogleImportedPropertyInput,
): Property {
  const result = buildProperty({
    id: input.propertyId,
    organizationId: input.organizationId,
    name: input.name,
    providedSlug: `import-${input.importItemId}`,
    timezone: input.timezone,
    address: input.address,
    gbpLocationId: input.locationId,
    gbpAccountId: input.accountId,
    googleConnectionId: input.connectionId,
    profileConfirmedAt: input.now,
    profileConfirmedBy: input.confirmedBy,
    countryCode: input.countryCode,
    countrySource: 'tenant_confirmed',
    now: input.now,
  })
  if (result.isErr()) throw result.error

  return {
    ...result.value,
    timezoneSource: 'tenant_confirmed',
    timezoneResolvedAt: input.now,
  }
}
