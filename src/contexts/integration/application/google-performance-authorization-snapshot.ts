import type { GooglePerformanceAuthorizationSnapshot } from './get-property-google-performance'

export function sameGooglePerformanceScope(
  current: GooglePerformanceAuthorizationSnapshot,
  expected: GooglePerformanceAuthorizationSnapshot,
): boolean {
  return (
    current.organizationId === expected.organizationId &&
    current.propertyId === expected.propertyId &&
    current.connectionId === expected.connectionId &&
    current.locationId === expected.locationId &&
    current.timezone === expected.timezone &&
    current.sourceEpoch === expected.sourceEpoch &&
    current.profileVersion === expected.profileVersion &&
    current.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
    current.connectionAccessVersion === expected.connectionAccessVersion &&
    current.principalHmacKeyVersion === expected.principalHmacKeyVersion &&
    current.principalHmac === expected.principalHmac
  )
}
