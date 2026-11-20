// Wires the print read, wording and PDF download to their repositories and renderer.

import { createHash } from 'node:crypto'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalLastPrintRepository } from './printing/portal-last-print-repository.port.server'
import type { PortalPrintWordingRepository } from './printing/portal-print-wording-repository.port.server'
import type { PortalMediaAssetRepository } from './media/portal-media-asset-repository.port.server'
import type { PortalPublicationRepository } from './publication/portal-publication-repository.port.server'
import type { PortalRepository } from './publication/portal-repository.port.server'
import type { StoragePort } from './application/ports/storage.port'
import { createPortalPrint } from './printing/create-portal-print.server'
import { getPortalPrintKit } from './printing/get-portal-print-kit.server'
import { savePortalPrintWording } from './printing/save-portal-print-wording.server'
import type { RevealPortalAddress } from './addresses/reveal-portal-address.server'
import type { PortalPrintRenderer } from './printing/pdfkit-print-renderer.port.server'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PropertyCountryReader } from './printing/print-kit-property-country.server'

export type PortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'loadWorkingCopyWithLook' | 'findActiveForPortal'
  >
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  /** The kit's memory of each Portal's last print. */
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
const lazyRenderer = (now: () => Date): PortalPrintRenderer => ({
  render: async (input) => {
    const { createPdfKitPrintRenderer } =
      await import('./printing/pdfkit-print-renderer.server')
    return createPdfKitPrintRenderer({ now }).render(input)
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
    createPortalPrint: createPortalPrint({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      mediaRepo: deps.mediaRepo,
      objectStore: deps.objectStore,
      sha256Hex,
      revealAddress: deps.revealAddress,
      renderer: lazyRenderer(deps.clock),
      propertyCountry: deps.propertyCountry,
      lastPrintRepo: deps.lastPrintRepo,
      wordingRepo: deps.wordingRepo,
      clock: deps.clock,
      logger: deps.logger,
    }),
  }
}
