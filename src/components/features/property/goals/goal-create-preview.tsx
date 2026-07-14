// Live preview — re-states the goal-in-progress in plain language.
// Reads the same FormState the fields write to, so it updates as the user
// chooses metric / scope / target / timeframe. Sticky on desktop.
import { Target, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { GoalProgressRing } from '#/components/goals/goal-progress-ring'
import {
  goalTypeLabel,
  measureLabel,
  metricLabel,
  targetUnit,
  computeElapsedFraction,
  computeExpectedValue,
} from '#/contexts/goal/ui/helpers'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { PortalOption } from './goal-entity-types'
import type { FormState } from './go-create-form-state'

type Props = Readonly<{
  state: FormState
  propertyName: string
  portals: readonly PortalOption[]
  portalGroups: readonly PortalOption[]
}>

export function GoalCreatePreview({
  state: s,
  propertyName,
  portals,
  portalGroups,
}: Props) {
  const metricKey = (s.metricKey || null) as MetricKey | null

  const measure = measureLabel(metricKey, s.aggregation)
  const where = whereLabel(s, propertyName, portals, portalGroups)
  const target = targetLabel(s, metricKey)
  const timeframe = timeframeLabel(s)

  return (
    <Card className="gap-4 py-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" />
          Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live progress ring preview (0 current in builder, shows notch when period known) */}
        {Number(s.targetValue) > 0 && (
          <div className="flex justify-center">
            <GoalProgressRing
              currentValue={0}
              targetValue={Number(s.targetValue)}
              status="active"
              periodStart={s.periodStart ? new Date(s.periodStart) : null}
              periodEnd={s.periodEnd ? new Date(s.periodEnd) : null}
              expectedValue={
                s.periodStart && s.periodEnd
                  ? computeExpectedValue(
                      Number(s.targetValue),
                      computeElapsedFraction(
                        new Date(s.periodStart),
                        new Date(s.periodEnd),
                      ),
                    )
                  : undefined
              }
              size="md"
              showLabel={false}
            />
          </div>
        )}

        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-medium capitalize">{measure}</span>{' '}
          <span className="text-muted-foreground">for</span>{' '}
          <span className="font-medium">{where}</span>
          {target && (
            <>
              {' '}
              <span className="text-muted-foreground">— target</span>{' '}
              <span className="font-medium">{target}</span>
            </>
          )}
          {timeframe && (
            <>
              {' '}
              <span className="text-muted-foreground">·</span> <span>{timeframe}</span>
            </>
          )}
          .
        </p>

        <div className="flex flex-wrap gap-1.5">
          {metricKey && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Target className="size-3" />
              {metricLabel(metricKey)}
            </Badge>
          )}
          {s.goalType && (
            <Badge variant="outline" className="font-normal">
              {goalTypeLabel(s.goalType)}
            </Badge>
          )}
        </div>

        {!metricKey && (
          <p className="text-xs text-muted-foreground">
            Pick a metric to see how this goal will read.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Summary builders ───────────────────────────────────────────────────────

function whereLabel(
  s: FormState,
  propertyName: string,
  portals: readonly PortalOption[],
  portalGroups: readonly PortalOption[],
): string {
  if (s.entityScope === 'property') return propertyName || 'this property'
  const pool = s.entityScope === 'portal' ? portals : portalGroups
  const found = pool.find((p) => p.id === s.entityId)
  return found?.name ?? (s.entityScope === 'portal' ? 'a portal' : 'a portal group')
}

function targetLabel(s: FormState, metricKey: MetricKey | null): string {
  if (!s.targetValue) return ''
  const unit = metricKey ? targetUnit(metricKey, s.aggregation) : ''
  return unit ? `${s.targetValue} ${unit}` : s.targetValue
}

function timeframeLabel(s: FormState): string {
  switch (s.goalType) {
    case 'one_shot': {
      const fmt = (v: string) => {
        if (!v) return ''
        const d = new Date(v)
        return Number.isNaN(d.getTime())
          ? ''
          : d.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })
      }
      const a = fmt(s.periodStart)
      const b = fmt(s.periodEnd)
      if (a && b) return `${a} → ${b}`
      return 'between two dates'
    }
    case 'recurring':
      return `resets ${s.recurrenceFrequency.replace('ly', 'ly')}`
    case 'rolling':
      return s.rollingWindowDays ? `last ${s.rollingWindowDays} days` : 'rolling window'
    case 'open':
      return 'ongoing'
  }
}
