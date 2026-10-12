// One goal / Several portals, the two views of the New goal page: one form for
// one goal, or a table with a number per Portal that makes a goal of each. Both
// are the same route, the table under `?mode=several`, so Back steps between
// them and either can be bookmarked: `LinkTabs`, as on the Goals page.
import { LinkTab, LinkTabs } from '#/components/ui/link-tabs'

export type GoalNewView = 'one' | 'several'

export function GoalNewTabs({
  propertyId,
  view,
  subject,
}: Readonly<{
  propertyId: string
  view: GoalNewView
  /** The subject a link chose for the single goal form; kept across the two views. */
  subject?: string
}>) {
  return (
    <LinkTabs aria-label="New goal views">
      <LinkTab
        to="/properties/$propertyId/goals/new"
        params={{ propertyId }}
        search={{ subject }}
        current={view === 'one'}
      >
        One goal
      </LinkTab>
      <LinkTab
        to="/properties/$propertyId/goals/new"
        params={{ propertyId }}
        search={{ subject, mode: 'several' }}
        current={view === 'several'}
      >
        Several portals
      </LinkTab>
    </LinkTabs>
  )
}
