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
