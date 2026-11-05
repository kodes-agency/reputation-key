// Wires the print read, wording and PDF download to their repositories and renderer.

import { createHash } from 'node:crypto'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalLastPrintRepository } from './application/ports/portal-last-print.repository'
import type { PortalPrintWordingRepository } from './application/ports/portal-print-wording.repository'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'
import type { PortalPublicationRepository } from './application/ports/portal-publication.repository'
import type { PortalRepository } from './application/ports/portal.repository'
import type { StoragePort } from './application/ports/storage.port'
import { createPortalPrintFinal } from './application/use-cases/create-portal-print-final'
import { getPortalPrintKit } from './application/use-cases/get-portal-print-kit'
import { savePortalPrintWording } from './application/use-cases/save-portal-print-wording'
import type { RevealPortalAddress } from './application/use-cases/reveal-portal-address'
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
  /** Reports a failed last-print or wording save without withholding the file. */
  logger: Pick<LoggerPort, 'warn'>
}>

// The PDF renderer carries the font data URIs, which only the bundlers (Vite,
// tsup) can import; loading it on first use keeps every process that never
// makes a print kit (the simulation script under tsx among them) from
// resolving them.
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
    }),
    savePortalPrintWording: savePortalPrintWording({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      wordingRepo: deps.wordingRepo,
      clock: deps.clock,
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
      lastPrintRepo: deps.lastPrintRepo,
      wordingRepo: deps.wordingRepo,
      clock: deps.clock,
      logger: deps.logger,
    }),
  }
}
