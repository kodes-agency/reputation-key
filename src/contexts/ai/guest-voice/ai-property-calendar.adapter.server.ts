import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { AiPropertyCalendarPort } from './ai-property-calendar.port.server'

const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

export const createAiPropertyCalendarAdapter = (db: Database): AiPropertyCalendarPort => {
  return Object.freeze({
    async resolveLocalDate(input) {
      const result = await db.execute(sql<{ local_date: string | null }>`
        SELECT ai_property_local_date_v1(
          to_timestamp(${input.reviewedAtEpochMillis}::numeric / 1000),
          ${input.timezone}
        )::text AS local_date
      `)
      const localDate = result.rows[0]?.local_date
      return typeof localDate === 'string' && LOCAL_DATE.test(localDate)
        ? localDate
        : null
    },
  })
}
