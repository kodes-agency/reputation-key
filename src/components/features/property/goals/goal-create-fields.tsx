// Goal create form — core fields (name, scope, type, target)
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { scopeLabel, goalTypeLabel } from '#/contexts/goal/ui/helpers'
import type { EntityScope, AggregationFunction } from '#/shared/domain/metric-keys'
import { GoalMetricFields } from './goal-create-metric-fields'
import { GoalCreateExtraFields } from './goal-create-extra-fields'

type F = {
  state: {
    name: string
    entityScope: EntityScope
    entityId: string
    errors: Record<string, string>
    metricKey: string
    aggregation: AggregationFunction
    goalType: 'open' | 'one_shot' | 'rolling' | 'recurring'
    targetValue: string
    periodStart: string
    periodEnd: string
    rollingWindowDays: string
    recurrenceFrequency: 'weekly' | 'monthly' | 'quarterly'
    description: string
  }
  setters: Record<string, (v: string) => void>
  availableMetrics: readonly string[]
  availableAggregations: readonly string[]
  showEntityPicker: boolean
  showPeriodDates: boolean
  showRollingWindow: boolean
  showRecurrenceRule: boolean
  isPending: boolean
  onCancel: () => void
}

export function GoalCreateFields({
  state: s,
  setters: $,
  availableMetrics,
  availableAggregations,
  showEntityPicker,
  showPeriodDates,
  showRollingWindow,
  showRecurrenceRule,
  isPending,
  onCancel,
}: F) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="goal-name">Name</FieldLabel>
        <Input
          id="goal-name"
          value={s.name}
          onChange={(e) => $.name(e.target.value)}
          placeholder="e.g. 50 scans this month"
          aria-invalid={!!s.errors.name}
        />
        {s.errors.name && <FieldError>{s.errors.name}</FieldError>}
      </Field>
      <Field>
        <FieldLabel>Entity Scope</FieldLabel>
        <Select value={s.entityScope} onValueChange={(v) => $.entityScope(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['property', 'portal', 'team', 'staff'] as EntityScope[]).map((scope) => (
              <SelectItem key={scope} value={scope}>
                {scopeLabel(scope)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <GoalMetricFields
        showEntityPicker={showEntityPicker}
        entityScope={s.entityScope}
        entityId={s.entityId}
        metricKey={s.metricKey}
        aggregation={s.aggregation}
        errors={s.errors}
        setters={$}
        availableMetrics={availableMetrics}
        availableAggregations={availableAggregations}
      />
      <Field>
        <FieldLabel>Goal Type</FieldLabel>
        <Select value={s.goalType} onValueChange={$.goalType}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['open', 'one_shot', 'rolling', 'recurring'] as const).map((type) => (
              <SelectItem key={type} value={type}>
                {goalTypeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="target-value">Target Value</FieldLabel>
        <Input
          id="target-value"
          type="number"
          min={0}
          step="any"
          value={s.targetValue}
          onChange={(e) => $.targetValue(e.target.value)}
          placeholder="e.g. 50"
          aria-invalid={!!s.errors.targetValue}
        />
        {s.errors.targetValue && <FieldError>{s.errors.targetValue}</FieldError>}
      </Field>
      <GoalCreateExtraFields
        showPeriodDates={showPeriodDates}
        showRollingWindow={showRollingWindow}
        showRecurrenceRule={showRecurrenceRule}
        state={s}
        setters={$}
        isPending={isPending}
        onCancel={onCancel}
      />
    </>
  )
}
