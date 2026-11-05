// The URL selects only the Google section's view; Portal goals stay the same. LinkTabs
// keeps views bookmarkable and exposes the current link to assistive technology.

import { LinkTab, LinkTabs } from '#/components/ui/link-tabs'

export type GoalView = 'active' | 'history'

const GOAL_VIEWS: ReadonlyArray<Readonly<{ value: GoalView; label: string }>> = [
  { value: 'active', label: 'Active' },
  { value: 'history', label: 'History' },
]

export function GoalViewTabs({
  propertyId,
  view,
}: Readonly<{ propertyId: string; view: GoalView }>) {
  return (
    <LinkTabs aria-label="Google rating goal views">
      {GOAL_VIEWS.map((option) => (
        <LinkTab
          key={option.value}
          to="/properties/$propertyId/goals"
          params={{ propertyId }}
          search={{ view: option.value }}
          current={option.value === view}
        >
          {option.label}
        </LinkTab>
      ))}
    </LinkTabs>
  )
}
