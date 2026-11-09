// Describe the current measure in the Property's time zone, including subject scope on
// Portal and group pages.

import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import { GoalClosedCard } from '../../../../components/goals/goal-history-list'
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
