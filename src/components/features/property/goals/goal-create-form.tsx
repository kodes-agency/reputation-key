import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  getMetricKeysForScope,
  getValidAggregationsForKey,
  getDefaultAggregationForKey,
} from '#/contexts/goal/ui/helpers'
import type {
  EntityScope,
  MetricKey,
  AggregationFunction,
} from '#/shared/domain/metric-keys'
import type { Action } from '#/components/hooks/use-action'
import type { CreateGoalInput } from '#/contexts/goal/application/dto/goal.dto'
import { GoalCreateFields } from './goal-create-fields'

type Props = { propertyId: string; mutation: Action<{ data: CreateGoalInput }, unknown> }

type FormState = {
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

const initial: FormState = {
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

export function GoalCreateForm({ propertyId, mutation }: Props) {
  const navigate = useNavigate()
  const [s, setS] = useState<FormState>(initial)

  const $: Record<string, (v: string) => void> = {}
  for (const k of Object.keys(s)) {
    const key = k as keyof FormState
    $[key] = (v: string) => setS((prev) => ({ ...prev, [key]: v }))
  }

  const availableMetrics = getMetricKeysForScope(s.entityScope)
  const availableAggregations = s.metricKey
    ? getValidAggregationsForKey(s.metricKey as MetricKey)
    : []

  // Override metricKey setter to auto-set default aggregation
  $.metricKey = (v: string) => {
    setS((prev) => ({
      ...prev,
      metricKey: v as MetricKey,
      aggregation: v ? getDefaultAggregationForKey(v as MetricKey) : prev.aggregation,
    }))
  }
  // Override entityScope setter to reset cascade
  $.entityScope = (v: string) => {
    setS((prev) => ({
      ...prev,
      entityScope: v as EntityScope,
      entityId: '',
      metricKey: '',
      aggregation: 'sum',
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!s.name.trim()) errs.name = 'Name is required'
    if (!s.metricKey) errs.metricKey = 'Metric key is required'
    if (!s.targetValue || Number(s.targetValue) <= 0)
      errs.targetValue = 'Target value must be positive'
    if (Object.keys(errs).length > 0) {
      setS((prev) => ({ ...prev, errors: errs }))
      return
    }
    setS((prev) => ({ ...prev, errors: {} }))

    const input: CreateGoalInput = {
      propertyId,
      name: s.name.trim(),
      goalType: s.goalType,
      aggregationFunction: s.aggregation,
      metricKey: s.metricKey as string & {},
      targetValue: Number(s.targetValue),
    }
    if (s.entityScope === 'portal') input.portalId = s.entityId || undefined
    else if (s.entityScope === 'team') input.teamId = s.entityId || undefined
    else if (s.entityScope === 'staff') input.staffId = s.entityId || undefined
    if (s.description.trim()) input.description = s.description.trim()
    if ((s.goalType === 'one_shot' || s.goalType === 'recurring') && s.periodStart)
      input.periodStart = s.periodStart
    if ((s.goalType === 'one_shot' || s.goalType === 'recurring') && s.periodEnd)
      input.periodEnd = s.periodEnd
    if (s.goalType === 'rolling' && s.rollingWindowDays)
      input.rollingWindowDays = Number(s.rollingWindowDays)
    if (s.goalType === 'recurring')
      input.recurrenceRule = { frequency: s.recurrenceFrequency }

    const result = await mutation({ data: input })
    const goalId = (result as { goal?: { id: string } } | undefined)?.goal?.id
    if (goalId)
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId },
      })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <GoalCreateFields
        state={s}
        setters={$}
        availableMetrics={availableMetrics}
        availableAggregations={availableAggregations}
        showEntityPicker={s.entityScope !== 'property'}
        showPeriodDates={s.goalType === 'one_shot' || s.goalType === 'recurring'}
        showRollingWindow={s.goalType === 'rolling'}
        showRecurrenceRule={s.goalType === 'recurring'}
        isPending={mutation.isPending}
        onCancel={() =>
          navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })
        }
      />
      {mutation.error != null && (
        <p className="text-sm text-destructive">
          Failed to create goal. Please try again.
        </p>
      )}
    </form>
  )
}
