import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { unbrand, type PropertyId } from '#/shared/domain/ids'

const localDateInTimezone = (at: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value
  const year = value('year')
  const month = value('month')
  const day = value('day')
  if (!year || !month || !day) throw new Error(`Cannot resolve local date in ${timeZone}`)
  return `${year}-${month}-${day}`
}

export const createPropertyLocalDateResolver =
  (db: Database) =>
  async (propertyId: PropertyId, at: Date): Promise<string> => {
    const rows = await db
      .select({ timezone: properties.timezone })
      .from(properties)
      .where(eq(properties.id, unbrand(propertyId)))
      .limit(1)
    const timezone = rows[0]?.timezone
    if (!timezone)
      throw new Error(`Property timezone unavailable: ${unbrand(propertyId)}`)
    return localDateInTimezone(at, timezone)
  }
