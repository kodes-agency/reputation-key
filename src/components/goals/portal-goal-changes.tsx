// "What changed" on the Monthly portal goal's page (copy deck P-10…P-12): each dated
// fact, newest first, in the shared History list (ADR 0068, amended 2026-10-19: one
// goal design system), closed until asked: the date in its column, the words beside
// it, a note on a line of its own under them; the first 12, then "Show all", which
// goes once pressed, so the first change it adds takes the focus. The list is a region
// named "What changed". People are named once the page knows them (`personName`). The
// words are `changeLines`'.
import { useState } from 'react'
import type { PortalGoalChange } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { Button } from '#/components/ui/button'
import { GoalHistoryList } from './goal-history-list'
import {
  FIRST_HIDDEN_CHANGE,
  anyChangeInAnotherYear,
  changeLines,
  type PortalGoalChangeLine,
} from './portal-goal-changes-view'

type Props = Readonly<{
  changes: readonly PortalGoalChange[]
  personName: (userId: string) => string | null
  /** Today, the Property's local day: a change of another year says its year. */
  today: string
}>

/** What a change says: the words, and its note on a line under them. */
function ChangeWords({ line }: Readonly<{ line: PortalGoalChangeLine }>) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>{line.text}</span>
      {line.note === null ? null : (
        <span className="text-muted-foreground">{line.note}</span>
      )}
    </span>
  )
}

export function PortalGoalChanges({ changes, personName, today }: Props) {
  const [all, setAll] = useState(false)
  if (changes.length === 0) return null
  const { lines, more } = changeLines(changes, personName, today, all)
  return (
    <GoalHistoryList
      title="What changed"
      region
      wideDates={anyChangeInAnotherYear(changes, today)}
      rows={lines.map((line) => ({
        key: line.key,
        when: line.date,
        content: <ChangeWords line={line} />,
      }))}
      revealedFrom={all ? FIRST_HIDDEN_CHANGE : null}
      more={
        more ? (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            onClick={() => setAll(true)}
          >
            Show all
          </Button>
        ) : null
      }
    />
  )
}
