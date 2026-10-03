// Active / History, the Goals page's two views. Each is the same route with a
// different `?view=`, so Back steps between them and either can be bookmarked:
// `LinkTabs`, a navigation landmark whose current link says `aria-current`
// (it was two Buttons, default beside outline, that said nothing to a screen
// reader about which view was on).
import { Link } from '@tanstack/react-router'
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
    <LinkTabs aria-label="Goal views">
      {GOAL_VIEWS.map((option) => (
        <LinkTab key={option.value} active={option.value === view}>
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            search={{ view: option.value }}
          >
            {option.label}
          </Link>
        </LinkTab>
      ))}
    </LinkTabs>
  )
}
