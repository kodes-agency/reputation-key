// Portal context — everything a new code is made of, short of the write.
//
// A code has one QR marker and one NFC marker, published with it in the same
// command (ADR 0069 derives a print code from each), and an address sealed for
// "download again" (ADR 0064). Issue and replace make them the same way, so there
// is one spelling: the sealed address, the artifacts and the facts that say they
// were published, the print-code hashes the row is stored with, and the URLs the
// manager is shown once the write has gone through. "Download again" has its own
// step, in print-code-reveal.server.ts.

import { portalAccessArtifactId } from '#/shared/domain/ids'
import { isPortalError } from '../domain/errors'
import { portalAccessArtifactPublished } from '../domain/events'
import {
  publishPortalAccessArtifact,
  type PortalAccessArtifactChannel,
} from '../domain/portal-access-artifact'
import type { Portal } from '../domain/types'
import type { PortalAddressCipher } from './portal-address-cipher.port.server'
import {
  portalPublicUrls,
  type PortalAddressFormat,
  type PortalPublicUrls,
} from './portal-address-urls.server'
import type { PortalTokenCodec } from './portal-token-codec.port.server'
import type { PrintCodeReporter } from './print-code-reporter.port.server'

export type MintNewCodeDeps = Readonly<{
  addressCipher: PortalAddressCipher | null
  tokenCodec: Pick<PortalTokenCodec, 'derivePrintCodes'>
  idGen: () => string
  address: PortalAddressFormat
}>

export function mintNewCode(
  deps: MintNewCodeDeps,
  input: Readonly<{
    portal: Pick<Portal, 'id' | 'organizationId' | 'propertyId'>
    token: Readonly<{
      id: string
      organizationId: string
      propertyId: string
      portalId: string
      version: number
    }>
    rawToken: string
    occurredAt: Date
    /** The Portal's new aggregate revision, which every fact of the command carries. */
    revision: Date
  }>,
) {
  const { portal, token, rawToken, occurredAt } = input
  const sealedAddress =
    deps.addressCipher?.seal(rawToken, {
      organizationId: token.organizationId,
      propertyId: token.propertyId,
      portalId: token.portalId,
      tokenId: token.id,
      version: token.version,
    }) ?? null
  const publish = (channel: PortalAccessArtifactChannel) =>
    publishPortalAccessArtifact({
      id: portalAccessArtifactId(deps.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: token.id,
      channel,
      now: occurredAt,
    })
  const qr = publish('qr')
  const nfc = publish('nfc')
  const eventFor = (artifact: typeof qr) =>
    portalAccessArtifactPublished({
      accessArtifactId: artifact.id,
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      channel: artifact.channel,
      sourceAggregateVersion: input.revision.toISOString(),
      occurredAt,
    })
  const artifactIds = { qr: qr.id, nfc: nfc.id }
  // A new row always has a well-formed long address and two artifact ids of its
  // own, so a null here is a defect, and it stops the command before anything is
  // written: a code row without hashes is only what an older image leaves behind.
  const printCodes = deps.tokenCodec.derivePrintCodes({
    rawToken,
    accessArtifactIds: artifactIds,
  })
  if (printCodes === null) {
    throw new Error('Print codes could not be derived for a new code')
  }
  return {
    sealedAddress,
    accessArtifacts: [qr, nfc] as const,
    accessArtifactEvents: [eventFor(qr), eventFor(nfc)] as const,
    printCodeHashes: {
      qr: printCodes.qr.printCodeHash,
      nfc: printCodes.nfc.printCodeHash,
    },
    /** Built after the write: the URLs are only shown once the code is stored. */
    urls: (): PortalPublicUrls =>
      portalPublicUrls(deps.address, {
        rawToken,
        artifacts: artifactIds,
        printCodes: { qr: printCodes.qr.printCode, nfc: printCodes.nfc.printCode },
      }),
    addressRecoverable: sealedAddress !== null,
  }
}

/**
 * Runs the write that stores a new code. A refused hash is reported (it has no
 * code or hash in it) and the refusal goes on to the manager, who presses the
 * button again: there is no retry (ADR 0069 decision 6).
 */
export async function reportingPrintCodeCollision<T>(
  report: PrintCodeReporter,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isPortalError(error) && error.code === 'print_code_collision') {
      report('collision')
    }
    throw error
  }
}
