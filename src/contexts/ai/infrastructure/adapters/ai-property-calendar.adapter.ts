import { sql } from 'drizzle-orm'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '#/shared/ai-property-calendar-profile'
import type { Database } from '#/shared/db'
import type { AiPropertyCalendarPort } from '../../application/ports/ai-property-calendar.port'

const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

export const createAiPropertyCalendarAdapter = (db: Database): AiPropertyCalendarPort => {
  return Object.freeze({
    async assertComplete() {
      return AI_PROPERTY_CALENDAR_PROFILE_V1.profileVersion === 'property-calendar-v1'
    },

    async resolveLocalDate(input) {
      if (input.calendarProfileVersion !== AI_PROPERTY_CALENDAR_PROFILE_V1.profileVersion) {
        return null
      }
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
