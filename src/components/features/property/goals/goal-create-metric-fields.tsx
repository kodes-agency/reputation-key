// Goal create form — metric key & aggregation selects
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Input } from '#/components/ui/input'
import { scopeLabel, aggregationLabel } from '#/contexts/goal/ui/helpers'
import type { AggregationFunction, EntityScope } from '#/shared/domain/metric-keys'

type MetricFieldsProps = Readonly<{
  showEntityPicker: boolean
  entityScope: EntityScope
  entityId: string
  metricKey: string
  aggregation: AggregationFunction
  errors: Record<string, string>
  setters: Record<string, (v: string) => void>
  availableMetrics: readonly string[]
  availableAggregations: readonly string[]
}>

export function GoalMetricFields({
  showEntityPicker,
  entityScope,
  entityId,
  metricKey,
  aggregation,
  errors,
  setters: $,
  availableMetrics,
  availableAggregations,
}: MetricFieldsProps) {
  return (
    <>
      {showEntityPicker && (
        <Field>
          <FieldLabel htmlFor="entity-id">{scopeLabel(entityScope)} ID</FieldLabel>
          <Input
            id="entity-id"
            value={entityId}
            onChange={(e) => $.entityId(e.target.value)}
            placeholder={`Enter ${scopeLabel(entityScope).toLowerCase()} ID`}
          />
        </Field>
      )}
      <Field>
        <FieldLabel>Metric Key</FieldLabel>
        <Select value={metricKey} onValueChange={$.metricKey}>
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
        {errors.metricKey && (
          <span className="text-sm text-destructive">{errors.metricKey}</span>
        )}
      </Field>
      <Field>
        <FieldLabel>Aggregation</FieldLabel>
        <Select
          value={aggregation}
          onValueChange={(v) => $.aggregation(v)}
          disabled={!metricKey}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={metricKey ? 'Select aggregation' : 'Select a metric first'}
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
    </>
  )
}
