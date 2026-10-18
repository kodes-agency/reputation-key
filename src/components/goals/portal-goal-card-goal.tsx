// The Monthly portal goal on its card, minimal until the running card draws
// its bar, rows and pace (copy deck G-20…G-22): while it waits for its first
// month, that month and its number, the day it starts and this month so far;
// while it runs, the figure of the month's own number and what is left to go
// with the days left. The figure is the governed read's, never a forecast.
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { goalLines } from './portal-goal-words'

type Props = Readonly<{
  goal: PortalGoalOfCard
  /** The Property's local day today. */
  today: string
}>

export function PortalGoalCardGoal({ goal, today }: Props) {
  const [headline, ...rest] = goalLines(goal, today)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-base font-medium tabular-nums">{headline}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm text-muted-foreground tabular-nums">
          {line}
        </p>
      ))}
    </div>
  )
}
