// In-memory PortalAddressCipher fake — for use in use case tests.
//
// Reversible and bound to the row like the real cipher: a value opens only with
// the scope that sealed it, so a test that passes the wrong scope still fails.

import type {
  PortalAddressCipher,
  PortalAddressContext,
} from '#/contexts/portal/application/ports/portal-address-cipher.port'

const scopeOf = (context: PortalAddressContext): string =>
  [
    context.organizationId,
    context.propertyId,
    context.portalId,
    context.tokenId,
    context.version,
  ].join('/')

export const createInMemoryPortalAddressCipher = (
  input: Readonly<{
    activeKeyVersion?: number
    retainedKeyVersions?: readonly number[]
  }> = {},
): PortalAddressCipher => {
  const active = input.activeKeyVersion ?? 1
  const openable = new Set([active, ...(input.retainedKeyVersions ?? [])])
  return {
    seal: (rawToken, context) => ({
      keyVersion: active,
      ciphertext: `sealed|${scopeOf(context)}|${rawToken}`,
    }),
    open: (sealed, context) => {
      const prefix = `sealed|${scopeOf(context)}|`
      if (!openable.has(sealed.keyVersion) || !sealed.ciphertext.startsWith(prefix)) {
        throw new Error('in-memory portal address cipher: cannot open')
      }
      return sealed.ciphertext.slice(prefix.length)
    },
    canOpen: (keyVersion) => openable.has(keyVersion),
  }
}
