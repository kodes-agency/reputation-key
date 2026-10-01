import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { SealedPortalAddress } from './portal-address-cipher.port'

/** The live code's sealed address and what is needed to rebuild its URLs. */
export type RevealableAddress = Readonly<{
  tokenId: string
  propertyId: string
  version: number
  issuedAt: Date
  sealed: SealedPortalAddress
  /** The published QR and NFC markers of this code; both must exist. */
  accessArtifactIds: Readonly<{ qr: string; nfc: string }>
}>

export type AddressDownloadPurpose = 'download' | 'copy'

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
}>
