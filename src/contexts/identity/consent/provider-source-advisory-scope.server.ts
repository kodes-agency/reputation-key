const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const UUID_SHAPE =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u
const UNSIGNED = /^(0|[1-9][0-9]*)$/u

function invalid(field: string): never {
  throw new TypeError(`Invalid provider-source advisory scope value: ${field}`)
}

/**
 * The text `ai_advisory_lock_key_v1` hashes (seed 0) to serialise work on one
 * Property source epoch. Every writer that must exclude the consent transition
 * passes these exact bytes.
 */
export function providerSourceAdvisoryScope(
  organizationId: string,
  propertyId: string,
  sourceEpoch: number,
): string {
  if (!UUID.test(organizationId)) {
    if (UUID_SHAPE.test(organizationId) || !SAFE_SCOPE_ID.test(organizationId)) {
      invalid('organization identifier')
    }
  }
  if (!UUID.test(propertyId)) invalid('property UUID')
  if (
    !Number.isSafeInteger(sourceEpoch) ||
    sourceEpoch < 0 ||
    !UNSIGNED.test(String(sourceEpoch))
  ) {
    invalid('epoch')
  }
  return `provider-source|${organizationId}|${propertyId}|${sourceEpoch}`
}
