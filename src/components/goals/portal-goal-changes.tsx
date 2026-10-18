// "Changes" on the Monthly portal goal's page (copy deck P-10…P-12): each dated
// fact, newest first, with a note on its own line; the first 12, then "Show
// all". People are named once the page knows them (`personName`). The words are
// `changeLines`'.
import { useId, useState } from 'react'
import type { PortalGoalChange } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { Button } from '#/components/ui/button'
import { SectionTitle } from '#/components/ui/section-title'
import { changeLines } from './portal-goal-changes-view'

type Props = Readonly<{
  changes: readonly PortalGoalChange[]
  personName: (userId: string) => string | null
}>

export function PortalGoalChanges({ changes, personName }: Props) {
  const headingId = useId()
  const [all, setAll] = useState(false)
  if (changes.length === 0) return null
  const { lines, more } = changeLines(changes, personName, all)
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionTitle id={headingId}>Changes</SectionTitle>
      <ul className="flex flex-col gap-2 text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-col gap-0.5">
            <span>
              <span className="text-muted-foreground tabular-nums">{line.date}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                {' · '}
              </span>
              {line.text}
            </span>
            {line.note === null ? null : (
              <span className="text-muted-foreground">{line.note}</span>
            )}
          </li>
        ))}
      </ul>
      {more ? (
        <Button
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => setAll(true)}
        >
          Show all
        </Button>
      ) : null}
    </section>
  )
}
