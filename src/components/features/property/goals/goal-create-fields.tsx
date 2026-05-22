// Goal create form — field components split to satisfy max-lines

import { Button } from '#/components/ui/button'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { scopeLabel, goalTypeLabel, aggregationLabel } from '#/contexts/goal/ui/helpers'
import type { EntityScope, AggregationFunction } from '#/shared/domain/metric-keys'

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
      {showEntityPicker && (
        <Field>
          <FieldLabel htmlFor="entity-id">{scopeLabel(s.entityScope)} ID</FieldLabel>
          <Input
            id="entity-id"
            value={s.entityId}
            onChange={(e) => $.entityId(e.target.value)}
            placeholder={`Enter ${scopeLabel(s.entityScope).toLowerCase()} ID`}
          />
        </Field>
      )}
      <Field>
        <FieldLabel>Metric Key</FieldLabel>
        <Select value={s.metricKey} onValueChange={$.metricKey}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a metric" />
          </SelectTrigger>
          <SelectContent>
            {availableMetrics.map((key: string) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {s.errors.metricKey && <FieldError>{s.errors.metricKey}</FieldError>}
      </Field>
      <Field>
        <FieldLabel>Aggregation</FieldLabel>
        <Select
          value={s.aggregation}
          onValueChange={(v) => $.aggregation(v)}
          disabled={!s.metricKey}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={s.metricKey ? 'Select aggregation' : 'Select a metric first'}
            />
          </SelectTrigger>
          <SelectContent>
            {availableAggregations.map((agg: string) => (
              <SelectItem key={agg} value={agg}>
                {aggregationLabel(agg as AggregationFunction)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
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
      {showPeriodDates && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="period-start">Start Date</FieldLabel>
            <Input
              id="period-start"
              type="datetime-local"
              value={s.periodStart}
              onChange={(e) => $.periodStart(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="period-end">End Date</FieldLabel>
            <Input
              id="period-end"
              type="datetime-local"
              value={s.periodEnd}
              onChange={(e) => $.periodEnd(e.target.value)}
            />
          </Field>
        </div>
      )}
      {showRollingWindow && (
        <Field>
          <FieldLabel htmlFor="rolling-days">Rolling Window (days)</FieldLabel>
          <Input
            id="rolling-days"
            type="number"
            min={1}
            value={s.rollingWindowDays}
            onChange={(e) => $.rollingWindowDays(e.target.value)}
            placeholder="e.g. 30"
          />
        </Field>
      )}
      {showRecurrenceRule && (
        <Field>
          <FieldLabel>Recurrence Frequency</FieldLabel>
          <Select value={s.recurrenceFrequency} onValueChange={$.recurrenceFrequency}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
        <Textarea
          id="description"
          value={s.description}
          onChange={(e) => $.description(e.target.value)}
          placeholder="Describe this goal..."
          rows={3}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Goal'}
        </Button>
      </div>
    </>
  )
}
