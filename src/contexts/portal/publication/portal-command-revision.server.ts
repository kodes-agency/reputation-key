import { sql, type SQL } from 'drizzle-orm'
import { portals } from '#/shared/db/schema/portal.schema'

/**
 * Advances the shared Portal command revision while the caller holds the
 * Portal row lock. Wall-clock time is useful event metadata, but it is not a
 * safe concurrency token by itself: delayed work can carry an older time.
 */
export function nextLockedPortalRevision(observedAt: Date): SQL<Date> {
  return sql<Date>`GREATEST(
    ${observedAt},
    ${portals.updatedAt} + INTERVAL '1 millisecond'
  )`
}
