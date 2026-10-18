// "Changes" on the Monthly portal goal's page (copy deck P-10…P-12): each dated
// fact, newest first, with a note on its own line; the first 12, then "Show
// all", which goes once pressed, so the first change it adds takes the focus.
// People are named once the page knows them (`personName`). The words are
// `changeLines`'.
import { useCallback, useId, useRef, useState } from 'react'
import type { PortalGoalChange } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { Button } from '#/components/ui/button'
import { SectionTitle } from '#/components/ui/section-title'
import { FIRST_HIDDEN_CHANGE, changeLines } from './portal-goal-changes-view'

type Props = Readonly<{
  changes: readonly PortalGoalChange[]
  personName: (userId: string) => string | null
  /** Today, the Property's local day: a change of another year says its year. */
  today: string
}>

export function PortalGoalChanges({ changes, personName, today }: Props) {
  const headingId = useId()
  const [all, setAll] = useState(false)
  // Set by "Show all" alone, so a later render never moves the focus again.
  const revealing = useRef(false)
  const focusFirstAdded = useCallback((item: HTMLLIElement | null) => {
    if (item === null || !revealing.current) return
    revealing.current = false
    item.focus()
  }, [])
  if (changes.length === 0) return null
  const { lines, more } = changeLines(changes, personName, today, all)
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionTitle id={headingId}>Changes</SectionTitle>
      <ul className="flex flex-col gap-2 text-sm">
        {lines.map((line, index) => {
          const firstAdded = index === FIRST_HIDDEN_CHANGE
          return (
            <li
              key={line.key}
              ref={firstAdded ? focusFirstAdded : undefined}
              tabIndex={firstAdded ? -1 : undefined}
              className="flex flex-col gap-0.5 outline-none"
            >
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
          )
        })}
      </ul>
      {more ? (
        <Button
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => {
            revealing.current = true
            setAll(true)
          }}
        >
          Show all
        </Button>
      ) : null}
    </section>
  )
}
