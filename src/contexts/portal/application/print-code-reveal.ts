// Portal context — the print codes "Download again" hands back (ADR 0069
// decision 7).
//
// The sealed copy is the long address. The reveal derives both print codes from
// it and the code's two artifact ids, fills the hashes a code made before print
// codes lacks, and answers a code only where the stored hash is the derived one.
// Every other case is the long address for that channel, and none of them fails
// the reveal: a manager can always download again, and a reveal that cannot vouch
// for a print code simply does not print it. Each is reported as a stable name,
// never with the code, the hash or the address.

import { isPortalError } from '../domain/errors'
import type { DerivedPrintCodes, PortalTokenCodec } from './ports/portal-token-codec.port'
import type {
  PortalAddressRepository,
  RevealableAddress,
  StoredPrintCodeHashes,
} from './ports/portal-address.repository'
import type { PrintCodeReporter } from './ports/print-code-reporter.port'
import type { ChannelPrintCodes } from './portal-address-urls'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

const NO_PRINT_CODES: ChannelPrintCodes = { qr: null, nfc: null }

type RevealPrintCodeDeps = Readonly<{
  tokenCodec: Pick<PortalTokenCodec, 'derivePrintCodes'>
  portalAddressRepo: Pick<PortalAddressRepository, 'fillPrintCodeHashes'>
  reportPrintCodeProblem: PrintCodeReporter
}>

type RevealScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
}>

/**
 * What the code row stores once any missing hash is filled, or null when there
 * is nothing to vouch for: the write failed (reported), or the code stopped or
 * was replaced since the read (nothing to report). A row that already holds both
 * is not written.
 */
async function storedHashes(
  deps: RevealPrintCodeDeps,
  scope: RevealScope,
  live: RevealableAddress,
  derived: DerivedPrintCodes,
): Promise<StoredPrintCodeHashes | null> {
  const held = live.printCodeHashes
  if (held.qr !== null && held.nfc !== null) return held
  try {
    return await deps.portalAddressRepo.fillPrintCodeHashes({
      ...scope,
      tokenId: live.tokenId,
      qr: derived.qr.printCodeHash,
      nfc: derived.nfc.printCodeHash,
    })
  } catch (error) {
    const collided = isPortalError(error) && error.code === 'print_code_collision'
    deps.reportPrintCodeProblem(collided ? 'collision' : 'fill_failed')
    return null
  }
}

/**
 * The print code of each channel that the code row vouches for, null for the
 * rest. A null fill (the code stopped or was replaced between the read and the
 * write) is a code that no longer prints anything, so it is not a problem to
 * report.
 */
export async function revealedPrintCodes(
  deps: RevealPrintCodeDeps,
  scope: RevealScope,
  live: RevealableAddress,
  rawToken: string,
): Promise<ChannelPrintCodes> {
  const derived = deps.tokenCodec.derivePrintCodes({
    rawToken,
    accessArtifactIds: live.accessArtifactIds,
  })
  if (derived === null) {
    deps.reportPrintCodeProblem('derive_mismatch')
    return NO_PRINT_CODES
  }
  const stored = await storedHashes(deps, scope, live, derived)
  if (stored === null) return NO_PRINT_CODES
  const agrees = {
    qr: stored.qr === derived.qr.printCodeHash,
    nfc: stored.nfc === derived.nfc.printCodeHash,
  }
  if (!agrees.qr || !agrees.nfc) deps.reportPrintCodeProblem('derive_mismatch')
  return {
    qr: agrees.qr ? derived.qr.printCode : null,
    nfc: agrees.nfc ? derived.nfc.printCode : null,
  }
}
