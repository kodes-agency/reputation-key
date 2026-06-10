// Goal create form — metric key & aggregation selects
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { aggregationLabel } from '#/contexts/goal/ui/helpers'
import type { AggregationFunction, EntityScope } from '#/shared/domain/metric-keys'
import type { PortalOption } from './goal-entity-types'
import { EntityPicker } from './goal-entity-picker'

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
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
  propertyId: string
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
  portals,
  portalGroups,
  propertyId,
}: MetricFieldsProps) {
  return (
    <>
      {showEntityPicker && (
        <EntityPicker
          entityScope={entityScope}
          entityId={entityId}
          setters={$}
          errors={errors}
          portals={portals}
          portalGroups={portalGroups}
          propertyId={propertyId}
        />
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
