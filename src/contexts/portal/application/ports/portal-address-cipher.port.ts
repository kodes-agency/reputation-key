// Portal context — sealing the raw public address (round 4, slice 33).
//
// The raw address is the one thing a Portal's code is made of: a QR image and an
// NFC tag both carry it. Sealing it lets a manager download the code again
// without the address ever being stored in the clear. The port is optional in
// the composition: with no keyring there is no cipher, and the address is shown
// once when a code is made (ADR 0062).

/**
 * What binds a sealed address to its row. A ciphertext copied to another tenant,
 * Portal, token or version does not open.
 */
export type PortalAddressContext = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  tokenId: string
  version: number
}>

export type SealedPortalAddress = Readonly<{
  /** `iv:tag:ciphertext`, each part base64. Opaque to everything but the adapter. */
  ciphertext: string
  /** Which key of the keyring sealed it; stored beside the ciphertext. */
  keyVersion: number
}>

export type PortalAddressCipher = Readonly<{
  /** Seals with the active key. Throws `PortalAddressCipherError`; never returns a partial value. */
  seal(rawToken: string, context: PortalAddressContext): SealedPortalAddress
  /** Throws `PortalAddressCipherError` for a wrong key, a wrong scope or a damaged value. */
  open(sealed: SealedPortalAddress, context: PortalAddressContext): string
  /** Whether the keyring still holds the key that sealed a row, so the UI never offers a dead button. */
  canOpen(keyVersion: number): boolean
}>
