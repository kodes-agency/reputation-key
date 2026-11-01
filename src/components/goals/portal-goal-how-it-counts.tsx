// "How this goal counts" on the Monthly portal goal's page (copy deck P-13, P-14):
// closed until asked, in the same closed card as "What changed", in what the goal
// counts now, on the Property's time; on a Portal's or a group's own page, where it
// counts (PLAN PG-21). The words are `howItCountsWords`'.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import { GoalClosedCard } from './goal-history-list'
import { HOW_IT_COUNTS_TITLE, howItCountsWords } from './portal-goal-page-view'

type Props = Readonly<{
  measure: PortalGoalMeasure
  timezone: string
  /** Where the ratings count: a goal's own Portal or group; else any of the Property's. */
  where?: string
}>

export function PortalGoalHowItCounts({ measure, timezone, where }: Props) {
  return (
    <GoalClosedCard title={HOW_IT_COUNTS_TITLE}>
      <p className="text-sm text-muted-foreground">
        {howItCountsWords(measure, timezone, where)}
      </p>
    </GoalClosedCard>
  )
}
