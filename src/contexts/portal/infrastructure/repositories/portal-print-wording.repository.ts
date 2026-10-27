import { and, eq, lte } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import { portalPrintWordings } from '#/shared/db/schema/portal-print-wording.schema'
import { unbrand } from '#/shared/domain/ids'
import { PRINT_FINAL_CALLS_TO_ACTION } from '#/shared/domain/portal-print-final-copy'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'
import { trace } from '#/shared/observability/trace'
import type { PortalPrintWordingRepository } from '../../application/ports/portal-print-wording.repository'

/** The row as the table keeps it, read through the same vocabularies the kit's download is. */
const rowSchema = z.object({
  callToAction: z.enum(PRINT_FINAL_CALLS_TO_ACTION),
  // Words a later rule would refuse are still the words that were saved: only their shape is read.
  callToActionCustom: z
    .partialRecord(
      guestLocaleSchema,
      z.object({ headline: z.string().min(1), subline: z.string() }),
    )
    .nullable(),
})

/**
 * The saved wording, one row per Portal. Every statement names the Organization
 * and the Portal; a write is also held by the composite foreign key into
 * `portals`, so a row can only be made for the Portal of that Property.
 */
export const createPortalPrintWordingRepository = (
  db: Database,
): PortalPrintWordingRepository => ({
  save: (input) =>
    trace('portalPrintWording.save', async () => {
      const values = {
        callToAction: input.wording.callToAction,
        callToActionCustom: input.wording.customWords,
        updatedAt: input.savedAt,
      }
      const written = await db
        .insert(portalPrintWordings)
        .values({
          portalId: unbrand(input.portalId),
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          ...values,
        })
        .onConflictDoUpdate({
          target: portalPrintWordings.portalId,
          set: values,
          // A wording that finished late leaves the later one in place.
          setWhere: and(
            eq(portalPrintWordings.organizationId, unbrand(input.organizationId)),
            lte(portalPrintWordings.updatedAt, input.savedAt),
          ),
        })
        .returning({ portalId: portalPrintWordings.portalId })
      return written.length === 1
    }),

  find: (organizationIdValue, portalIdValue) =>
    trace('portalPrintWording.find', async () => {
      const [row] = await db
        .select({
          callToAction: portalPrintWordings.callToAction,
          callToActionCustom: portalPrintWordings.callToActionCustom,
        })
        .from(portalPrintWordings)
        .where(
          and(
            eq(portalPrintWordings.organizationId, unbrand(organizationIdValue)),
            eq(portalPrintWordings.portalId, unbrand(portalIdValue)),
          ),
        )
        .limit(1)
      if (row === undefined) return null
      // A row the vocabularies cannot read any more is no saved wording.
      const parsed = rowSchema.safeParse(row)
      return parsed.success
        ? {
            callToAction: parsed.data.callToAction,
            customWords: parsed.data.callToActionCustom,
          }
        : null
    }),
})
