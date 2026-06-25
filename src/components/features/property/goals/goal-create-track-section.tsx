// Goal create — Section 1 (What to track) + Section 2 (Target).
import { cn } from '#/lib/utils'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  SectionCard,
  ChoiceTile,
  METRIC_ICONS,
  SCOPE_ICONS,
  SCOPES,
  AGG_VERB,
} from './goal-create-tiles'
import {
  scopeLabel,
  METRIC_META,
  getMetricKeysForScope,
  getValidAggregationsForKey,
} from '#/contexts/goal/ui/helpers'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { PortalOption } from './goal-entity-types'
import { EntityPicker } from './goal-entity-picker'
import type { FormState } from './go-create-form-state'

type Setters = Record<string, (v: string) => void>

export function TrackSection({
  state: s,
  setters: $,
  portals,
  portalGroups,
  propertyId,
}: Readonly<{
  state: FormState
  setters: Setters
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
  propertyId: string
}>) {
  const availableMetrics = getMetricKeysForScope(s.entityScope)
  const metricKey = (s.metricKey || null) as MetricKey | null

  return (
    <SectionCard
      title="What do you want to track?"
      description="Pick a metric and where it applies."
    >
      <Field>
        <FieldLabel>Applies to</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-3">
          {SCOPES.map((scope) => (
            <ChoiceTile
              key={scope}
              selected={s.entityScope === scope}
              onClick={() => $.entityScope(scope)}
              icon={SCOPE_ICONS[scope]}
              title={scopeLabel(scope)}
            />
          ))}
        </div>
      </Field>

      {s.entityScope !== 'property' && (
        <EntityPicker
          entityScope={s.entityScope}
          entityId={s.entityId}
          setters={$}
          errors={s.errors}
          portals={portals}
          portalGroups={portalGroups}
          propertyId={propertyId}
        />
      )}

      <Field>
        <FieldLabel>Metric</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          {availableMetrics.map((key) => (
            <ChoiceTile
              key={key}
              selected={metricKey === key}
              onClick={() => $.metricKey(key)}
              icon={METRIC_ICONS[key]}
              title={METRIC_META[key].label}
              description={METRIC_META[key].description}
            />
          ))}
        </div>
        {s.errors.metricKey && <FieldError>{s.errors.metricKey}</FieldError>}
      </Field>
    </SectionCard>
  )
}

export function TargetSection({
  state: s,
  setters: $,
}: Readonly<{ state: FormState; setters: Setters }>) {
  const metricKey = (s.metricKey || null) as MetricKey | null
  const isRating = metricKey === 'portal.rating'
  const aggregations = metricKey ? getValidAggregationsForKey(metricKey) : []
  const targetUnit = (() => {
    if (!metricKey) return ''
    if (isRating && (s.aggregation === 'avg' || s.aggregation === 'max')) return '★'
    return METRIC_META[metricKey].unit
  })()

  return (
    <SectionCard
      title="Set your target"
      description={`How high do you want to aim${metricKey ? ` for ${METRIC_META[metricKey].label.toLowerCase()}` : ''}?`}
    >
      {isRating && (
        <Field>
          <FieldLabel>Measured by</FieldLabel>
          <Select value={s.aggregation} onValueChange={(v) => $.aggregation(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aggregations.map((agg) => (
                <SelectItem key={agg} value={agg}>
                  {AGG_VERB[agg]} rating
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="target-value">Target</FieldLabel>
        <div className="relative">
          <Input
            id="target-value"
            type="number"
            min={0}
            step={isRating && s.aggregation === 'avg' ? '0.1' : '1'}
            value={s.targetValue}
            onChange={(e) => $.targetValue(e.target.value)}
            placeholder={isRating ? 'e.g. 4.5' : 'e.g. 50'}
            aria-invalid={!!s.errors.targetValue}
            className={cn(targetUnit && 'pr-20')}
          />
          {targetUnit && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {targetUnit}
            </span>
          )}
        </div>
        {s.errors.targetValue && <FieldError>{s.errors.targetValue}</FieldError>}
      </Field>
    </SectionCard>
  )
}
