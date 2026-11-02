import { MetricStrip, Metric, MetricValue } from '#/components/ui/metric-strip'
import { GoalMeter } from '#/components/goals/goal-meter'
import { SectionTitle } from '#/components/ui/section-title'
import { formatNumber } from '#/lib/format'
import type { StaffResults, StaffGoal, StaffColleague, StaffPeriod } from './types'

export function StaffResultsView({
  period,
  results,
}: Readonly<{ period: StaffPeriod; results: StaffResults }>) {
  return (
    <div className="space-y-4">
      <MetricStrip aria-label="Your scans" variant="personal">
        <Metric label="scans">
          <MetricValue value={formatNumber(results.scans)} />
        </Metric>
      </MetricStrip>
      {period === 'today' ? (
        <p className="text-xs text-muted-foreground">Ratings update each morning.</p>
      ) : (
        <>
          <MetricStrip aria-label="Your ratings" variant="ruled">
            <Metric label="ratings">
              <MetricValue value={formatNumber(results.ratingCount ?? 0)} />
            </Metric>
            <Metric
              label={
                results.averageRating === undefined
                  ? 'average, from 5 ratings'
                  : 'average'
              }
            >
              <MetricValue
                value={
                  results.averageRating === undefined
                    ? '–'
                    : formatNumber(results.averageRating, { maximumFractionDigits: 1 })
                }
              />
            </Metric>
          </MetricStrip>
          <p className="text-xs text-muted-foreground">Up to last night</p>
        </>
      )}
    </div>
  )
}

export function StaffGoals({ goals }: Readonly<{ goals: readonly StaffGoal[] }>) {
  if (goals.length === 0) return null
  return (
    <section aria-label="Scan goals" className="space-y-5 border-t pt-5">
      {goals.map((goal) => {
        const name = goal.name || 'Your goal'
        const figure = `${formatNumber(goal.scans)} of ${formatNumber(goal.target)} scans`
        return (
          <GoalMeter
            key={goal.id}
            slot="staff-goal"
            caption={name}
            figure={figure}
            foot={null}
            bar={{ value: goal.scans, max: goal.target, label: name, valueText: figure }}
          />
        )
      })}
    </section>
  )
}

export function StaffColleagues({
  colleagues,
}: Readonly<{ colleagues: readonly StaffColleague[] }>) {
  return (
    <section aria-labelledby="staff-colleagues-title" className="space-y-3 border-t pt-5">
      <SectionTitle id="staff-colleagues-title">All staff</SectionTitle>
      <ul className="space-y-2">
        {colleagues.map((person, index) => (
          <li key={index} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 break-words">
              {person.displayName}
              {person.isYou && (
                <span className="ml-2 text-xs text-muted-foreground">you</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{formatNumber(person.scans)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
