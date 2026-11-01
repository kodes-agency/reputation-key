import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestQualifiedScans } from '#/shared/db/schema/guest.schema'
import { portalAccessArtifacts } from '#/shared/db/schema/portal.schema'
import type { PortalScanPatternsReader } from '../../application/ports/portal-scan-patterns.reader'

/** One statement, using business time and the Property’s local clock even across DST. */
export const createPortalScanPatternsReader =
  (db: Database): PortalScanPatternsReader =>
  async (input) => {
    const localTime = sql`${guestQualifiedScans.occurredAt} AT TIME ZONE ${input.timezone}`
    const hour = sql<number>`EXTRACT(HOUR FROM ${localTime})::integer`
    const weekday = sql<number>`(EXTRACT(ISODOW FROM ${localTime})::integer - 1)`
    const rows = await db
      .select({ channel: portalAccessArtifacts.channel, hour, weekday, scans: count() })
      .from(guestQualifiedScans)
      .innerJoin(
        portalAccessArtifacts,
        and(
          eq(portalAccessArtifacts.id, guestQualifiedScans.accessArtifactId),
          eq(portalAccessArtifacts.organizationId, guestQualifiedScans.organizationId),
          eq(portalAccessArtifacts.propertyId, guestQualifiedScans.propertyId),
          eq(portalAccessArtifacts.portalId, guestQualifiedScans.portalId),
        ),
      )
      .where(
        and(
          eq(guestQualifiedScans.organizationId, input.organizationId),
          eq(guestQualifiedScans.propertyId, input.propertyId),
          eq(guestQualifiedScans.portalId, input.portalId),
          isNull(guestQualifiedScans.retractedAt),
          gte(guestQualifiedScans.occurredAt, input.startAt),
          lt(guestQualifiedScans.occurredAt, input.endAt),
        ),
      )
      .groupBy(portalAccessArtifacts.channel, sql`2`, sql`3`)
    return rows.map((row) => {
      if (row.channel !== 'qr' && row.channel !== 'nfc')
        throw new Error('Unknown scan channel')
      return {
        ...row,
        channel: row.channel,
        hour: Number(row.hour),
        weekday: Number(row.weekday),
        scans: Number(row.scans),
      }
    })
  }
