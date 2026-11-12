// Show all removes its trigger, so focus the first revealed change.

import { useState } from 'react'
import type { PortalGoalChange } from '#/contexts/reporting/monthly-goals/contracts'
import { Button } from '#/components/ui/button'
import { GoalHistoryList } from '../../../../components/goals/goal-history-list'
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
