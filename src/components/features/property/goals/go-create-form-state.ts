import type {
  EntityScope,
  MetricKey,
  AggregationFunction,
} from '#/shared/domain/metric-keys'

export type FormState = {
  name: string
  entityScope: EntityScope
  entityId: string
  metricKey: MetricKey | ''
  aggregation: AggregationFunction
  goalType: 'open' | 'one_shot' | 'rolling' | 'recurring'
  targetValue: string
  periodStart: string
  periodEnd: string
  rollingWindowDays: string
  recurrenceFrequency: 'weekly' | 'monthly' | 'quarterly'
  description: string
  errors: Record<string, string>
}

export const initial: FormState = {
  name: '',
  entityScope: 'property',
  entityId: '',
  metricKey: '',
  aggregation: 'sum',
  goalType: 'open',
  targetValue: '',
  periodStart: '',
  periodEnd: '',
  rollingWindowDays: '',
  recurrenceFrequency: 'monthly',
  description: '',
  errors: {},
}

export function buildScopeOverrides(scope: EntityScope, entityId: string) {
  const eid = entityId || undefined
  if (scope === 'portal') return { portalId: eid }
  if (scope === 'team') return { portalId: eid, teamId: eid }
  if (scope === 'staff') return { portalId: eid, teamId: eid, staffId: eid }
  return {}
}
