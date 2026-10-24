// Portal context — the print codes of a code row's life (ADR 0069 decision 6).
//
// Issue and replace derive both print codes from the new long address and the two
// new access-artifact ids, and store the keyed hashes with the row. These are the
// two steps they share. "Download again" has its own, in print-code-reveal.ts.

import { isPortalError } from '../domain/errors'
import type { DerivedPrintCodes, PortalTokenCodec } from './ports/portal-token-codec.port'
import type { PrintCodeReporter } from './ports/print-code-reporter.port'
import type { ChannelPrintCodes } from './portal-address-urls'

/** The two hashes a code row is stored with, one per access-artifact channel. */
export type PrintCodeHashes = Readonly<{ qr: string; nfc: string }>

export const printCodeHashesOf = (derived: DerivedPrintCodes): PrintCodeHashes => ({
  qr: derived.qr.printCodeHash,
  nfc: derived.nfc.printCodeHash,
})

export const printCodesOf = (derived: DerivedPrintCodes): ChannelPrintCodes => ({
  qr: derived.qr.printCode,
  nfc: derived.nfc.printCode,
})

/**
 * The print codes of a code that is being made. A new row always has a
 * well-formed long address and two artifact ids of its own, so a null here is a
 * defect, and it stops the command before anything is written: a code row
 * without hashes is only what an older image leaves behind.
 */
export function derivePrintCodesForNewCode(
  codec: Pick<PortalTokenCodec, 'derivePrintCodes'>,
  input: Parameters<PortalTokenCodec['derivePrintCodes']>[0],
): DerivedPrintCodes {
  const derived = codec.derivePrintCodes(input)
  if (derived === null) throw new Error('Print codes could not be derived for a new code')
  return derived
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
