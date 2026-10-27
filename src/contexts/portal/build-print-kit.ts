// Portal context — the print kit's wiring (round 4, slice 45).
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: the print kit read and the PDF are wired here from the repositories
// buildPortalContext already made, with the PDFKit renderer behind its port. The
// final kit's PDF (behind PRINT_KIT_FINAL_ENABLED) is wired beside today's.

import { createHash } from 'node:crypto'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalLastPrintRepository } from './application/ports/portal-last-print.repository'
import type { PortalPrintWordingRepository } from './application/ports/portal-print-wording.repository'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'
import type { PortalPublicationRepository } from './application/ports/portal-publication.repository'
import type { PortalRepository } from './application/ports/portal.repository'
import type { StoragePort } from './application/ports/storage.port'
import { createPortalPrintFinal } from './application/use-cases/create-portal-print-final'
import { createPortalPrintKit } from './application/use-cases/create-portal-print-kit'
import { getPortalPrintKit } from './application/use-cases/get-portal-print-kit'
import { savePortalPrintWording } from './application/use-cases/save-portal-print-wording'
import type { RevealPortalAddress } from './application/use-cases/reveal-portal-address'
import type { PortalPrintKitRenderer } from './application/ports/portal-print-kit-renderer.port'
import type { PortalPrintFinalRenderer } from './application/ports/portal-print-final-renderer.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PropertyCountryReader } from './infrastructure/print-kit/print-kit-property-country'

export type PortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  /** The final kit's memory of each Portal's last print. */
  lastPrintRepo: PortalLastPrintRepository
  /** The wording each Portal saved for Share to open on. */
  wordingRepo: PortalPrintWordingRepository
  objectStore: Pick<StoragePort, 'getObject'>
  revealAddress: RevealPortalAddress
  /** The Property's country, which sets the paper a print defaults to. */
  propertyCountry: PropertyCountryReader
  clock: () => Date
  /**
   * Hears what is worth a look but does not stop a print, such as a logo that
   * prints soft, and what shape of address a print carried (`info`).
   */
  logger: Pick<LoggerPort, 'warn' | 'info'>
  /** PRINT_KIT_FINAL_ENABLED: the Share tab shows the final kit instead of today's. */
  finalKitEnabled: boolean
}>

// The PDF renderer carries the font data URIs, which only the bundlers (Vite,
// tsup) can import; loading it on first use keeps every process that never
// makes a print kit (the simulation script under tsx among them) from
// resolving them.
const lazyRenderer = (
  now: () => Date,
  logger: Pick<LoggerPort, 'warn' | 'info'>,
): PortalPrintKitRenderer => ({
  render: async (input) => {
    const { createPdfKitPrintKitRenderer } =
      await import('./infrastructure/print-kit/pdfkit-print-kit-renderer')
    return createPdfKitPrintKitRenderer({
      now,
      warn: (warning) => logger.warn(warning.context, warning.message),
      // The shape of the address and the symbol's version, never the address.
      reportRender: (facts) => logger.info(facts, 'Print kit rendered'),
    }).render(input)
  },
})

/** The final kit's renderer, loaded on first use for the same reason. */
const lazyFinalRenderer = (now: () => Date): PortalPrintFinalRenderer => ({
  render: async (input) => {
    const { createPdfKitPrintFinalRenderer } =
      await import('./infrastructure/print-kit/pdfkit-print-final-renderer')
    return createPdfKitPrintFinalRenderer({ now }).render(input)
  },
})

export function buildPortalPrintKit(deps: PortalPrintKitDeps) {
  const sha256Hex = (bytes: Uint8Array) =>
    createHash('sha256').update(bytes).digest('hex')
  return {
    getPortalPrintKit: getPortalPrintKit({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      lastPrintRepo: deps.lastPrintRepo,
      wordingRepo: deps.wordingRepo,
      mediaRepo: deps.mediaRepo,
      finalKitEnabled: deps.finalKitEnabled,
    }),
    savePortalPrintWording: savePortalPrintWording({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      wordingRepo: deps.wordingRepo,
      clock: deps.clock,
      finalKitEnabled: deps.finalKitEnabled,
    }),
    createPortalPrintKit: createPortalPrintKit({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      mediaRepo: deps.mediaRepo,
      objectStore: deps.objectStore,
      sha256Hex,
      revealAddress: deps.revealAddress,
      renderer: lazyRenderer(deps.clock, deps.logger),
      propertyCountry: deps.propertyCountry,
    }),
    createPortalPrintFinal: createPortalPrintFinal({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      mediaRepo: deps.mediaRepo,
      objectStore: deps.objectStore,
      sha256Hex,
      revealAddress: deps.revealAddress,
      renderer: lazyFinalRenderer(deps.clock),
      propertyCountry: deps.propertyCountry,
      finalKitEnabled: deps.finalKitEnabled,
      lastPrintRepo: deps.lastPrintRepo,
      wordingRepo: deps.wordingRepo,
      clock: deps.clock,
      logger: deps.logger,
    }),
  }
}
