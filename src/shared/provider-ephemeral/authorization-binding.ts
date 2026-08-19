import { createHash } from 'node:crypto'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type ProviderAuthorizationVectorValue = string | number | boolean | null

export function canonicalProviderAuthorizationVector(
  vector: Readonly<Record<string, ProviderAuthorizationVectorValue>>,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(vector).sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

export function providerAuthorizationVectorSha256(
  input: Readonly<{
    connectionLifecycleVersion: number
    connectionAccessVersion: number
    credentialGeneration: number
    authorizationVector: Readonly<Record<string, ProviderAuthorizationVectorValue>>
  }>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.connectionLifecycleVersion,
        input.connectionAccessVersion,
        input.credentialGeneration,
        canonicalProviderAuthorizationVector(input.authorizationVector),
      ]),
      'utf8',
    )
    .digest('hex')
}

/**
 * `credentialGeneration` is the only authorization-vector member a routine
 * Google token refresh moves, and a refresh changes nothing an authorization
 * fence must protect. Content leases therefore bind this separate digest
 * domain, which drops that one member and keeps every other fact — connection
 * lifecycle/access versions, policy and emergency-kill versions, role,
 * permission digest, property source/profile state — byte exact.
 */
export const PROVIDER_AUTHORIZATION_FENCE_EXCLUDED_KEY = 'credentialGeneration'

export function providerAuthorizationFenceSha256(
  input: Readonly<{
    connectionLifecycleVersion: number
    connectionAccessVersion: number
    authorizationVector: Readonly<Record<string, ProviderAuthorizationVectorValue>>
  }>,
): string {
  const fenced = Object.fromEntries(
    Object.entries(input.authorizationVector).filter(
      ([key]) => key !== PROVIDER_AUTHORIZATION_FENCE_EXCLUDED_KEY,
    ),
  )
  return createHash('sha256')
    .update(
      JSON.stringify([
        'provider-authorization-fence-v1',
        input.connectionLifecycleVersion,
        input.connectionAccessVersion,
        canonicalProviderAuthorizationVector(fenced),
      ]),
      'utf8',
    )
    .digest('hex')
}

export function createProviderAuthorizationPrincipalBinding(
  input: Readonly<{
    keys: VersionedHmacKeyring
    audience: string
    organizationId: string
    userId: string
    connectionId: string
  }>,
): Readonly<{
  principalHmacKeyVersion: string
  principalHmac: string
}> {
  const principal = input.keys.sign(
    input.audience,
    JSON.stringify([input.organizationId, input.userId, input.connectionId]),
  )
  return Object.freeze({
    principalHmacKeyVersion: principal.keyVersion,
    principalHmac: principal.digest,
  })
}
