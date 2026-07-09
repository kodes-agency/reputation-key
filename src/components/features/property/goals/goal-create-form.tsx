import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getDefaultAggregationForKey } from '#/contexts/goal/ui/helpers'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { Action } from '#/components/hooks/use-action'
import type { CreateGoalInput } from '#/contexts/goal/application/dto/goal.dto'
import { createGoalSchema } from '#/contexts/goal/application/dto/goal.dto'
import { GoalCreateFields } from './goal-create-fields'
import { GoalCreatePreview } from './goal-create-preview'
import type { PortalOption } from './goal-entity-types'
import { type FormState, initial, buildScopeOverrides } from './go-create-form-state'

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

  // Generic string setter for every field, then two cascade overrides below.
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
  $.entityScope = (v: string) => {
    setS((prev) => ({
      ...prev,
      entityScope: v as FormState['entityScope'],
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
    navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })

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
