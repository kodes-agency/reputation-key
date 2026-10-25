// Portal context — what the final print kit remembers of a Portal's last print
// (final design spec §11, slice 12). One row per Portal, replaced by each print:
// the choices the download took and the photo it used. Every method names the
// Organization and the Portal; nothing here holds an address, a code or a file.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type {
  PrintFinalLastPhoto,
  PrintFinalLastSettings,
} from '#/shared/domain/portal-print-final-last'

/** A Portal's last print as it was stored. */
export type PortalLastPrint = Readonly<{
  printedAt: Date
  settings: PrintFinalLastSettings
  /** The photo an Immersive print used; null for a Paper print, or an Immersive one with no photo. */
  photo: PrintFinalLastPhoto | null
}>

export type RecordPortalLastPrintInput = PortalLastPrint &
  Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
  }>

export type PortalLastPrintRepository = Readonly<{
  /**
   * Remembers a print as the Portal's last, replacing the one before it. A print
   * that is older than the one stored does not replace it, so two downloads that
   * finish out of order leave the later one. Returns whether the row was written.
   */
  record: (input: RecordPortalLastPrintInput) => Promise<boolean>
  /**
   * The Portal's last print, or null when it was never printed or the row can no
   * longer be read (a language the catalogue no longer has): the next print writes
   * it again.
   */
  find: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalLastPrint | null>
}>
