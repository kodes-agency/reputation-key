export type GoalMetricSourceStatus = Readonly<{
  state: 'complete' | 'pending' | 'unavailable' | 'quarantined'
  relevantFactCount: number
  pendingFactCount: number
  reason: string | null
}>

export type GoalMetricSourceHead = Readonly<{
  value: string
  eventTypes: readonly string[]
}>
