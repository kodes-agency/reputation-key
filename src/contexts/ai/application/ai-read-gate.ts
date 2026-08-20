import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type {
  AiAuthorizationPort,
  AiMerchantAuthorizationSnapshot,
} from './ports/ai-authorization.port'
import type { PropertyProcessingProfilePort } from './ports/property-processing-profile.port'
import type { AiPropertyProcessingProfile } from '../domain/types'

/**
 * The gate every AI read passes before it may return tenant-derived output.
 *
 * Permissions are not sufficient here and never were: a caller can hold
 * `dashboard.read` while the merchant authorization is revoked, the specific
 * capability is killed, or the property's processing profile is mid-migration.
 * All three must be true, and all three are read from live state, not a claim.
 *
 * Extracted because this was the third copy — analysis, trend, and now the
 * dashboard aggregate read — and the copies had already begun to differ.
 */
export type AiReadGate =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{
      status: 'enabled'
      authorization: AiMerchantAuthorizationSnapshot
      profile: AiPropertyProcessingProfile
    }>

export type AiReadGateDependencies = Readonly<{
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
}>

export async function resolveAiReadGate(
  dependencies: AiReadGateDependencies,
  input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  capability: MerchantAiCapability,
): Promise<AiReadGate> {
  const [authorization, runtime] = await Promise.all([
    dependencies.authorization.readMerchantAuthorization(input),
    dependencies.processingProfiles.readForAi(input),
  ])
  if (
    authorization === null ||
    authorization.state !== 'enabled' ||
    !authorization.capabilities.includes(capability) ||
    runtime.status !== 'available'
  ) {
    return { status: 'disabled' }
  }
  return { status: 'enabled', authorization, profile: runtime.profile }
}
