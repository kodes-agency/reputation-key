// Portal context — the print kit's wiring (round 4, slice 45).
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: the print kit read and the PDF are wired here from the repositories
// buildPortalContext already made, with the PDFKit renderer behind its port.

import { createHash } from 'node:crypto'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'
import type { PortalPublicationRepository } from './application/ports/portal-publication.repository'
import type { PortalRepository } from './application/ports/portal.repository'
import type { StoragePort } from './application/ports/storage.port'
import { createPortalPrintKit } from './application/use-cases/create-portal-print-kit'
import { getPortalPrintKit } from './application/use-cases/get-portal-print-kit'
import type { RevealPortalAddress } from './application/use-cases/reveal-portal-address'
import type { PortalPrintKitRenderer } from './application/ports/portal-print-kit-renderer.port'
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
  objectStore: Pick<StoragePort, 'getObject'>
  revealAddress: RevealPortalAddress
  /** The Property's country, which sets the paper a print defaults to. */
  propertyCountry: PropertyCountryReader
  clock: () => Date
  /** Hears what is worth a look but does not stop a print, such as a logo that prints soft. */
  logger: Pick<LoggerPort, 'warn'>
  /** PRINT_KIT_FINAL_ENABLED: the Share tab shows the final kit instead of today's. */
  finalKitEnabled: boolean
}>

// The PDF renderer carries the font data URIs, which only the bundlers (Vite,
// tsup) can import; loading it on first use keeps every process that never
// makes a print kit (the simulation script under tsx among them) from
// resolving them.
const lazyRenderer = (
  now: () => Date,
  logger: Pick<LoggerPort, 'warn'>,
): PortalPrintKitRenderer => ({
  render: async (input) => {
    const { createPdfKitPrintKitRenderer } =
      await import('./infrastructure/print-kit/pdfkit-print-kit-renderer')
    return createPdfKitPrintKitRenderer({
      now,
      warn: (warning) => logger.warn(warning.context, warning.message),
    }).render(input)
  },
})

export function buildPortalPrintKit(deps: PortalPrintKitDeps) {
  return {
    getPortalPrintKit: getPortalPrintKit({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      finalKitEnabled: deps.finalKitEnabled,
    }),
    createPortalPrintKit: createPortalPrintKit({
      portalRepo: deps.portalRepo,
      staffPublicApi: deps.staffPublicApi,
      publicationRepo: deps.publicationRepo,
      mediaRepo: deps.mediaRepo,
      objectStore: deps.objectStore,
      sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
      revealAddress: deps.revealAddress,
      renderer: lazyRenderer(deps.clock, deps.logger),
      propertyCountry: deps.propertyCountry,
    }),
  }
}
