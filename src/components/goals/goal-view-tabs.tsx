// Active / History, the Google rating goal's two views on the Goals page. They
// are the Google section's own (P-7a, ADR 0068): drawn inside it, above the view
// they choose (`RatingGoalViews`), and named for it; the Portal goals below are
// the same on both. Each is the same route with a different `?view=`, so Back
// steps between them and either can be bookmarked: `LinkTabs`, a navigation
// landmark whose current link says `aria-current` (it was two Buttons, default
// beside outline, that said nothing to a screen reader about which view was on).
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
