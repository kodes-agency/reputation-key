// The URL selects only the Google section's view. Keep one named Google rating goal
// region; child views supply headings without duplicating its landmark.

import type { ReactNode } from 'react'
import { GoalViewTabs, type GoalView } from '#/components/goals/goal-view-tabs'

type Props = Readonly<{
  propertyId: string
  view: GoalView
  /** The view the tabs chose: the Google section's card on Active, its History on History. */
  children: ReactNode
}>

export function RatingGoalViews({ propertyId, view, children }: Props) {
  return (
    <section aria-label="Google rating goal" className="flex flex-col gap-4">
      <GoalViewTabs propertyId={propertyId} view={view} />
      {children}
    </section>
  )
}
