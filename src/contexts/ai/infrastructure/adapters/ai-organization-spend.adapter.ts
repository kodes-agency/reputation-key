import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { ORGANIZATION_MONTHLY_CAP_MICROS } from '#/shared/db/ai/ai-budget'
import type { AiOrganizationSpendPort } from '../../application/ports/ai-organization-spend.port'

type WindowRow = Readonly<{
  month_start: Date | string
  settled_micros: number | string | null
  reserved_micros: number | string | null
  cap_micros: number | string | null
}>

function safeMicros(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('AI organization cost window holds an invalid amount')
  }
  return parsed
}

export const createAiOrganizationSpendAdapter = (db: Database): AiOrganizationSpendPort =>
  Object.freeze({
    async readCurrentMonth(input) {
      const now = new Date(input.nowEpochMillis)
      // The window row is created by the first admission of the month, so its
      // absence means nothing has been spent yet, under the default cap.
      const result = await db.execute(sql`
        SELECT month.start AS month_start,
          cost_window.settled_micros, cost_window.reserved_micros, cost_window.cap_micros
        FROM (SELECT date_trunc('month', ${now}::timestamptz) AS start) AS month
        LEFT JOIN ai_organization_cost_windows AS cost_window
          ON cost_window.organization_id = ${input.organizationId}
         AND cost_window.window_start = month.start
      `)
      const row = result.rows[0] as WindowRow | undefined
      const monthStart = row ? new Date(row.month_start).getTime() : input.nowEpochMillis
      return {
        monthStartEpochMillis: monthStart,
        settledMicros: safeMicros(row?.settled_micros, 0),
        reservedMicros: safeMicros(row?.reserved_micros, 0),
        capMicros: safeMicros(row?.cap_micros, ORGANIZATION_MONTHLY_CAP_MICROS),
      }
    },
  })
