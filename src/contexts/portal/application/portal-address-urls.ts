// Portal context — the public URLs of one code.
//
// A code is one address with two markers: the QR image carries the address and
// its QR marker, the NFC tag carries the same address and the NFC marker. A
// visit that carries a marker is recorded as a scan from that channel. Issue,
// replace and "download again" all build the three here, so they can never
// disagree about what a code's URLs are.
//
// `qr` and `nfc` are what is printed or written to a tag. With a print code
// (ADR 0069) each is the short address on the print host, `<host>/p/<code>`, and
// the code itself stands for the marker. Without one it is the long address with
// its marker, as it always was. `direct` is the long address with no marker: the
// one for websites, emails and "Open page", where a visit must never count as a
// scan.

import type { PortalAccessArtifactChannel } from '../domain/portal-access-artifact'

export type PortalPublicUrls = Readonly<{
  /** What the QR image encodes: the QR column's print code, uppercase, or the long address. */
  qr: string
  /** What an NFC tag carries: the NFC column's print code, or the long address. */
  nfc: string
  /** The long address with no marker: "Public address" and "Open page". */
  direct: string
}>

/** The print code of each channel, or null where the long address stays (no code, or one that did not verify). */
export type ChannelPrintCodes = Readonly<
  Record<PortalAccessArtifactChannel, string | null>
>

export type PortalPublicUrlInput = Readonly<{
  appOrigin: string
  printOrigin: string
  rawToken: string
  artifacts: Readonly<Record<PortalAccessArtifactChannel, string>>
  printCodes: ChannelPrintCodes
}>

/** How a code's addresses are written, from the environment (ADR 0069). */
export type PortalAddressFormat = Readonly<{
  /** `BETTER_AUTH_URL`: where the guest page lives. */
  appOrigin: string
  /** `PORTAL_PRINT_ORIGIN` when set, else the app origin: where a print code is scanned. */
  printOrigin: string
  /**
   * `PORTAL_PRINT_CODES_ENABLED`. Off, every address a manager sees is the long
   * one, whatever has been minted: print codes are still derived and stored.
   */
  printCodesEnabled: boolean
}>

const NO_PRINT_CODES: ChannelPrintCodes = { qr: null, nfc: null }

export function buildPortalPublicUrls(input: PortalPublicUrlInput): PortalPublicUrls {
  const { appOrigin, rawToken } = input
  const direct = new URL(`/p/${rawToken}`, appOrigin).toString()
  const longFor = (artifactId: string): string => {
    const url = new URL(direct)
    url.searchParams.set('accessArtifact', artifactId)
    return url.toString()
  }
  const printBase = new URL(input.printOrigin).origin
  const { qr, nfc } = input.printCodes
  return {
    // The scheme and host are uppercase so the whole address but the one `p`
    // stays in the QR alphanumeric set (version 3, not 4). `/p/` is lowercase
    // because the guest cookie path is case-sensitive; the code is already
    // uppercase Crockford. A tag has no such limit, so its address keeps the
    // lowercase scheme and the NDEF `https://` prefix byte.
    qr: qr === null ? longFor(input.artifacts.qr) : `${printBase.toUpperCase()}/p/${qr}`,
    nfc: nfc === null ? longFor(input.artifacts.nfc) : `${printBase}/p/${nfc}`,
    direct,
  }
}

/**
 * A code's three addresses under the environment's choice: the print codes show
 * only when `PORTAL_PRINT_CODES_ENABLED` is on.
 */
export function portalPublicUrls(
  format: PortalAddressFormat,
  input: Readonly<{
    rawToken: string
    artifacts: PortalPublicUrlInput['artifacts']
    printCodes: ChannelPrintCodes
  }>,
): PortalPublicUrls {
  return buildPortalPublicUrls({
    appOrigin: format.appOrigin,
    printOrigin: format.printOrigin,
    rawToken: input.rawToken,
    artifacts: input.artifacts,
    printCodes: format.printCodesEnabled ? input.printCodes : NO_PRINT_CODES,
  })
}
