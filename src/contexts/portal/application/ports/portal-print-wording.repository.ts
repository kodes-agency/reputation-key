// Portal context — the wording a Portal saved for its final print kit (2026-10-27).
// One row per Portal, replaced by every save and every download: the wording id and
// the manager's own words, so Share opens on them next time. Every method names
// the Organization and the Portal; nothing here holds an address, a code, a file
// or who saved it.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PrintFinalSavedWording } from '#/shared/domain/portal-print-final-wording'

export type RecordPortalPrintWordingInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  wording: PrintFinalSavedWording
  savedAt: Date
}>

export type PortalPrintWordingRepository = Readonly<{
  /**
   * Saves the wording as the Portal's, replacing the one before it. A wording
   * older than the one stored does not replace it, so a save and a download that
   * finish out of order leave the later one. Returns whether the row was written.
   */
  save: (input: RecordPortalPrintWordingInput) => Promise<boolean>
  /**
   * The Portal's saved wording, or null when none was saved or the row can no
   * longer be read (a language the catalogue dropped, a wording that is gone):
   * Share then opens on the last print's wording, and the next save writes it again.
   */
  find: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PrintFinalSavedWording | null>
}>
