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
import { createGoalSchema } from '#/contexts/goal/application/dto/goal.dto'
import { GoalCreateFields } from './goal-create-fields'

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateGoalInput }, unknown>
}>

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

    const input = {
      propertyId,
      name: s.name.trim(),
      description: s.description.trim() || undefined,
      goalType: s.goalType,
      aggregationFunction: s.aggregation,
      metricKey: s.metricKey || undefined,
      targetValue: s.targetValue ? Number(s.targetValue) : undefined,
      periodStart: s.periodStart || undefined,
      periodEnd: s.periodEnd || undefined,
      recurrenceRule:
        s.goalType === 'recurring' ? { frequency: s.recurrenceFrequency } : undefined,
      rollingWindowDays: s.rollingWindowDays ? Number(s.rollingWindowDays) : undefined,
      ...(s.entityScope === 'portal' ? { portalId: s.entityId || undefined } : {}),
      ...(s.entityScope === 'portal_group'
        ? { portalId: s.entityId || undefined, groupId: s.entityId || undefined }
        : {}),
    }

    const errs: Record<string, string> = {}
    const parsed = createGoalSchema.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        if (!errs[key]) errs[key] = issue.message
      }
      setS((prev) => ({ ...prev, errors: errs }))
      return
    }
    setS((prev) => ({ ...prev, errors: {} }))

    try {
      await mutation({ data: parsed.data })
      setS(initial)
    } catch {
      // mutation hook handles error display
    }
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
