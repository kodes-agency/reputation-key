import { Flag, QrCode, Star } from 'lucide-react'
import { CheckInSection } from '#/components/features/shared/check-in-section'
import { GoalColumns } from '#/components/goals/goal-columns'
import { GoalMeter } from '#/components/goals/goal-meter'
import { SectionTitle } from '#/components/ui/section-title'
import { formatNumber } from '#/lib/format'
import {
  staffColumns,
  staffGoalAnswer,
  staffGoalCaption,
  staffRatingsAnswer,
  staffRatingsHint,
  staffScansAnswer,
  staffScansQuestion,
} from './staff-results-words'
import type { StaffColleague, StaffGoal, StaffPeriod, StaffResults } from './types'

export function StaffResultsView({
  period,
  results,
}: Readonly<{ period: StaffPeriod; results: StaffResults }>) {
  const { series } = results
  const unit = series?.unit === 'day' ? 'day' : 'week'
  return (
    <>
      <CheckInSection
        title={staffScansQuestion(period)}
        icon={<QrCode className="size-4" />}
        answer={staffScansAnswer(results.scans, period)}
      >
        {series && results.scans > 0 ? (
          <GoalColumns
            caption={`Scans each ${unit}`}
            columns={staffColumns(series)}
            label={`Scans; use left and right arrows to inspect each ${unit}.`}
            hint={
              series.columns.at(-1)?.open
                ? `The dashed bar is this ${unit} so far.`
                : `Each ${unit} of the month.`
            }
          />
        ) : null}
      </CheckInSection>
      {period === 'today' ? (
        <p className="text-sm text-muted-foreground">Ratings update each morning.</p>
      ) : (
        <CheckInSection
          title="What did they think?"
          icon={<Star className="size-4" />}
          // Amber is the star's own colour here, not a warning.
          tone="warn"
          answer={staffRatingsAnswer(results, period)}
          hint={staffRatingsHint(results, period)}
        >
          {null}
        </CheckInSection>
      )}
    </>
  )
}

export function StaffGoals({ goals }: Readonly<{ goals: readonly StaffGoal[] }>) {
  if (goals.length === 0) return null
  return (
    <CheckInSection
      title="How is your goal going?"
      icon={<Flag className="size-4" />}
      answer={staffGoalAnswer(goals)}
    >
      <div className="flex flex-col gap-3 py-1.5">
        {goals.map((goal) => {
          const caption = staffGoalCaption(goal)
          const figure = `${formatNumber(goal.scans)} of ${formatNumber(goal.target)} scans`
          return (
            <GoalMeter
              key={goal.id}
              slot="staff-goal"
              caption={caption}
              figure={figure}
              foot={null}
              bar={{
                value: goal.scans,
                max: goal.target,
                label: caption,
                valueText: figure,
              }}
            />
          )
        })}
      </div>
    </CheckInSection>
  )
}

export function StaffColleagues({
  colleagues,
  propertyName = '',
}: Readonly<{ propertyName?: string; colleagues: readonly StaffColleague[] }>) {
  return (
    <section
      aria-labelledby="staff-colleagues-title"
      className="rounded-xl border bg-card p-4 shadow-xs"
    >
      <SectionTitle id="staff-colleagues-title">
        All staff{propertyName ? ` at ${propertyName}` : ''}
      </SectionTitle>
      <ul className="mt-3 flex flex-col gap-2">
        {colleagues.map((person, index) => (
          <li key={index} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 break-words">
              {person.displayName}
              {person.isYou && (
                <span className="ml-2 text-xs text-muted-foreground">you</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatNumber(person.scans)} scans
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
