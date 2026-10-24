import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { SealedPortalAddress } from './portal-address-cipher.port'

/**
 * The keyed print code hashes a code row holds, one per access-artifact channel;
 * null where the row has none yet (a code made before print codes existed, or by
 * an older image). Credential material (ADR 0069): it goes nowhere but the
 * comparison in the reveal.
 */
export type StoredPrintCodeHashes = Readonly<{
  qr: string | null
  nfc: string | null
}>

/** The live code's sealed address and what is needed to rebuild its URLs. */
export type RevealableAddress = Readonly<{
  tokenId: string
  propertyId: string
  version: number
  issuedAt: Date
  sealed: SealedPortalAddress
  /** The published QR and NFC markers of this code; both must exist. */
  accessArtifactIds: Readonly<{ qr: string; nfc: string }>
  /** What the row stores now, so the reveal can fill what is missing and check what is not. */
  printCodeHashes: StoredPrintCodeHashes
}>

/**
 * What the manager did with the address they were handed: saved a code file
 * (`download`), put an address on the clipboard (`copy`), or only displayed it
 * (`show`).
 */
export type AddressDownloadPurpose = 'download' | 'copy' | 'show'

export type FillPrintCodeHashesInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  tokenId: string
  /** The hashes the reveal derived: written only where the row has none. */
  qr: string
  nfc: string
}>

export type RecordAddressDownloadInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  tokenId: string
  downloadedBy: UserId
  purpose: AddressDownloadPurpose
  at: Date
}>

/**
 * Reads of the sealed address, and the audit row that must exist before it is
 * decrypted. The ciphertext leaves this repository only through
 * `findRevealable`, and only the reveal use case calls it.
 */
export type PortalAddressRepository = Readonly<{
  /** The Portal's active code with a sealed address and both markers, or null. */
  findRevealable: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<RevealableAddress | null>
  /**
   * Records one download. False, with nothing written, when the code is no
   * longer active or no longer holds a sealed address: a stopped code cannot be
   * disclosed, and the row never describes a disclosure that did not happen.
   */
  recordDownload: (input: RecordAddressDownloadInput) => Promise<boolean>
  /**
   * Stores the derived hashes where the code row has none, and answers what the
   * row holds afterwards (a hash that was already there is kept). An idempotent
   * write of a derived value, like the download row: two racing reveals write the
   * same thing, so it needs no revision fence (ADR 0069 decision 7). Null, with
   * nothing written, when the code is no longer active or no longer sealed. A
   * unique violation is the typed `print_code_collision`.
   */
  fillPrintCodeHashes: (
    input: FillPrintCodeHashesInput,
  ) => Promise<StoredPrintCodeHashes | null>
}>
