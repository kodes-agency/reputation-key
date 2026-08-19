import type { AiPropertyTrendScheduleStorePort } from '../ports/ai-property-trend-schedule-store.port'

export type SchedulePropertyTrendsDependencies = Readonly<{
  schedules: AiPropertyTrendScheduleStorePort
}>

export type SchedulePropertyTrendsResult =
  | Readonly<{ status: 'busy' }>
  | Readonly<{
      status: 'scheduled'
      schedulerGeneration: number
      scheduledCount: number
      hasMore: boolean
    }>

export function createSchedulePropertyTrends(
  dependencies: SchedulePropertyTrendsDependencies,
): (input: Readonly<{ leaseOwner: string }>) => Promise<SchedulePropertyTrendsResult> {
  return (input) => dependencies.schedules.scheduleDueBatch(input)
}
