// The Google section of the Goals page with its two views (P-7a, ADR 0068): the
// Active / History tabs are the Google rating goal's own, so they sit inside its
// section, above the view they choose, and `?view=` chooses only here. The
// Portal goals below the section are the same on both views; their ended goals
// are on the Portal goal results page.
//
// The section is the page's one region named "Google rating goal": what it
// holds (the card, the door, History) draws its own heading but no region of
// its own, so no landmark is named twice.
import type { ReactNode } from 'react'
import { GoalViewTabs, type GoalView } from './goal-view-tabs'

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
