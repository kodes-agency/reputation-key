import { and, eq, lte } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import { portalLastPrints } from '#/shared/db/schema/portal-last-print.schema'
import { unbrand } from '#/shared/domain/ids'
import {
  PRINT_FINAL_LOOKS,
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  PRINT_FINAL_PRINTERS,
} from '#/shared/domain/portal-print-final'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_PAPERS,
} from '#/shared/domain/portal-print-kit'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'
import { trace } from '#/shared/observability/trace'
import type {
  PortalLastPrint,
  PortalLastPrintRepository,
  RecordPortalLastPrintInput,
} from '../../application/ports/portal-last-print.repository'

/** The row as the table keeps it, read through the same vocabularies the kit's download is. */
const rowSchema = z.object({
  piece: z.enum(PRINT_FINAL_PIECES),
  orientation: z.enum(PRINT_FINAL_ORIENTATIONS),
  look: z.enum(PRINT_FINAL_LOOKS),
  paper: z.enum(PRINT_KIT_PAPERS),
  printer: z.enum(PRINT_FINAL_PRINTERS),
  quantity: z.number().int(),
  fillSpares: z.boolean(),
  perSheet: z.number().int().nullable(),
  cropMarks: z.boolean(),
  backPage: z.boolean(),
  languages: z.array(guestLocaleSchema).min(1),
  callToAction: z.enum(PRINT_KIT_CALLS_TO_ACTION),
  photoAssetId: z.string().nullable(),
  photoFocalX: z.number().nullable(),
  photoFocalY: z.number().nullable(),
  printedAt: z.date(),
})

/** What a print writes: every column the next print replaces, never the Portal's own keys. */
function valuesOf(input: RecordPortalLastPrintInput) {
  const { settings, photo } = input
  return {
    piece: settings.piece,
    orientation: settings.orientation,
    look: settings.look,
    paper: settings.paper,
    printer: settings.printer,
    quantity: settings.quantity,
    fillSpares: settings.fillSpares,
    perSheet: settings.perSheet,
    cropMarks: settings.cropMarks,
    backPage: settings.backPage,
    languages: [...settings.languages],
    callToAction: settings.callToAction,
    photoAssetId: photo?.assetId ?? null,
    photoFocalX: photo?.focalX ?? null,
    photoFocalY: photo?.focalY ?? null,
    printedAt: input.printedAt,
  }
}

function lastPrintOf(row: z.infer<typeof rowSchema>): PortalLastPrint {
  const { photoAssetId, photoFocalX, photoFocalY, printedAt, ...choices } = row
  return {
    printedAt,
    settings: choices,
    photo:
      photoAssetId === null || photoFocalX === null || photoFocalY === null
        ? null
        : { assetId: photoAssetId, focalX: photoFocalX, focalY: photoFocalY },
  }
}

/**
 * The remembered last print, one row per Portal. Every statement names the
 * Organization and the Portal; a write is also held by the composite foreign key
 * into `portals`, so a row can only be made for the Portal of that Property.
 */
export const createPortalLastPrintRepository = (
  db: Database,
): PortalLastPrintRepository => ({
  record: (input) =>
    trace('portalLastPrint.record', async () => {
      const values = valuesOf(input)
      const written = await db
        .insert(portalLastPrints)
        .values({
          portalId: unbrand(input.portalId),
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          ...values,
        })
        .onConflictDoUpdate({
          target: portalLastPrints.portalId,
          set: values,
          // A print that finished late leaves the later one in place.
          setWhere: and(
            eq(portalLastPrints.organizationId, unbrand(input.organizationId)),
            lte(portalLastPrints.printedAt, input.printedAt),
          ),
        })
        .returning({ portalId: portalLastPrints.portalId })
      return written.length === 1
    }),

  find: (organizationIdValue, portalIdValue) =>
    trace('portalLastPrint.find', async () => {
      const [row] = await db
        .select()
        .from(portalLastPrints)
        .where(
          and(
            eq(portalLastPrints.organizationId, unbrand(organizationIdValue)),
            eq(portalLastPrints.portalId, unbrand(portalIdValue)),
          ),
        )
        .limit(1)
      if (row === undefined) return null
      // A row the vocabularies cannot read any more (a language the catalogue
      // dropped) is no remembered print: the next print writes it again.
      const parsed = rowSchema.safeParse(row)
      return parsed.success ? lastPrintOf(parsed.data) : null
    }),
})
