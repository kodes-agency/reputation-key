import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  getDefaultAggregationForKey,
  getMetricKeysForScope,
} from '#/contexts/goal/ui/helpers'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { Action } from '#/components/hooks/use-action'
import type { CreateGoalInput } from '#/contexts/goal/application/dto/goal.dto'
import { createGoalSchema } from '#/contexts/goal/application/dto/goal.dto'
import { GoalCreateFields } from './goal-create-fields'
import { GoalCreatePreview } from './goal-create-preview'
import type { PortalOption } from './goal-entity-types'
import { type FormState, initial, buildScopeOverrides } from './go-create-form-state'
import { thisMonthRange } from './goal-create-tiles'

type Props = Readonly<{
  propertyId: string
  propertyName: string
  mutation: Action<{ data: CreateGoalInput }, unknown>
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
}>

export function GoalCreateForm({
  propertyId,
  propertyName,
  mutation,
  portals,
  portalGroups,
}: Props) {
  const navigate = useNavigate()
  const [s, setS] = useState<FormState>(initial)

  // Generic string setter for every field, then specialized overrides below.
  const $: Record<string, (v: string) => void> = {}
  for (const k of Object.keys(s)) {
    if (k === 'errors') continue
    const key = k as keyof FormState
    $[key] = (v: string) => setS((prev) => ({ ...prev, [key]: v }))
  }

  // Choosing a metric resets aggregation to its default.
  $.metricKey = (v: string) => {
    setS((prev) => ({
      ...prev,
      metricKey: v as MetricKey,
      aggregation: v ? getDefaultAggregationForKey(v as MetricKey) : prev.aggregation,
    }))
  }

  // Changing scope clears the entity + metric (availability depends on scope).
  // For property scope we auto-select the only available metric (property.review).
  $.entityScope = (v: string) => {
    const newScope = v as FormState['entityScope']
    const available = getMetricKeysForScope(newScope)
    const autoMetric =
      newScope === 'property' && available.length === 1
        ? available[0]
        : ('' as MetricKey | '')

    setS((prev) => ({
      ...prev,
      entityScope: newScope,
      entityId: '',
      metricKey: autoMetric,
      aggregation: autoMetric ? getDefaultAggregationForKey(autoMetric) : 'sum',
    }))
  }

  // When goalType changes we must clear fields that are illegal for that type.
  // This prevents stale period dates from being sent for recurring/open/rolling.
  $.goalType = (v: string) => {
    const type = v as FormState['goalType']
    setS((prev) => {
      const next: Partial<FormState> = { goalType: type }

      if (type === 'one_shot') {
        if (!prev.periodStart) {
          const { start, end } = thisMonthRange()
          next.periodStart = start
          next.periodEnd = end
        }
        next.rollingWindowDays = ''
      } else if (type === 'rolling') {
        if (!prev.rollingWindowDays) next.rollingWindowDays = '30'
        next.periodStart = ''
        next.periodEnd = ''
      } else {
        // open | recurring
        next.periodStart = ''
        next.periodEnd = ''
        next.rollingWindowDays = ''
      }

      return { ...prev, ...next }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Sanitize fields that are not allowed for the chosen goalType.
    // This is the last line of defense before the domain constructor.
    const isOneShot = s.goalType === 'one_shot'
    const isRolling = s.goalType === 'rolling'
    const isRecurring = s.goalType === 'recurring'

    const input = {
      propertyId,
      name: s.name.trim(),
      description: s.description.trim() || undefined,
      goalType: s.goalType,
      aggregationFunction: s.aggregation,
      metricKey: s.metricKey || undefined,
      targetValue: s.targetValue ? Number(s.targetValue) : undefined,
      // Only one_shot is allowed to have explicit periods
      periodStart: isOneShot && s.periodStart ? s.periodStart : undefined,
      periodEnd: isOneShot && s.periodEnd ? s.periodEnd : undefined,
      recurrenceRule: isRecurring ? { frequency: s.recurrenceFrequency } : undefined,
      rollingWindowDays:
        isRolling && s.rollingWindowDays ? Number(s.rollingWindowDays) : undefined,
      ...buildScopeOverrides(s.entityScope, s.entityId),
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

  const cancel = () =>
    navigate({
      to: '/properties/$propertyId/goals',
      params: { propertyId },
      search: { view: 'active' },
    })

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <GoalCreateFields
          state={s}
          setters={$}
          portals={portals}
          portalGroups={portalGroups}
          propertyId={propertyId}
          isPending={mutation.isPending}
          onCancel={cancel}
        />
        <aside className="lg:sticky lg:top-6">
          <GoalCreatePreview
            state={s}
            propertyName={propertyName}
            portals={portals}
            portalGroups={portalGroups}
          />
        </aside>
      </div>
      {mutation.error != null && (
        <p className="mt-4 text-sm text-destructive">
          Failed to create goal. Please try again.
        </p>
      )}
    </form>
  )
}
