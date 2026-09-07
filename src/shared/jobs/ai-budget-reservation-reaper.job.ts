import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import { reapStaleReservations } from '#/shared/ai-provider-control/ai-budget'

export const AI_BUDGET_RESERVATION_REAPER_JOB_NAME =
  'ai-budget-reservation-reaper' as const

export function createAiBudgetReservationReaperHandler(
  db: Database,
): (_job: Job) => Promise<number> {
  return async () => db.transaction((tx) => reapStaleReservations(tx))
}
