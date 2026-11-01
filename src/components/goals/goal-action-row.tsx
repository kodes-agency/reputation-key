// One thing a manager can do, as a whole row (2026-11-01, ADR 0067 and 0068: one
// goal design system): an icon, what to do, why, and the chevron. A way to another
// page is the goal's own router link wearing `GOAL_ACTION_LINK`; a way to a sheet
// on this page is a button. Each goal words its own and says where it leads. The
// row's hover and ring are the shared row link's.
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { RowButton } from '#/components/ui/button-layouts'
import { ROW_LINK_SURFACE } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'

const INNER = 'flex w-full items-center gap-3 py-3 text-left'

/** A link that is a whole row. */
export const GOAL_ACTION_LINK = cn(INNER, ROW_LINK_SURFACE, 'rounded-sm')

type WordsProps = Readonly<{ icon: ReactNode; title: string; note: string | null }>

/** What the row says, inside the goal's link or the button below. */
export function GoalActionWords({ icon, title, note }: WordsProps) {
  return (
    <>
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        {note === null ? null : (
          <span className="text-sm font-normal text-muted-foreground">{note}</span>
        )}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </>
  )
}

/** A way to something on this page: the sheet that changes the plan or the number. */
export function GoalActionButton({
  onClick,
  ...words
}: WordsProps & Readonly<{ onClick: () => void }>) {
  return (
    <RowButton variant="ghost" className={INNER} onClick={onClick}>
      <GoalActionWords {...words} />
    </RowButton>
  )
}

/** The rows, one under another with a rule between them. */
export function GoalActionRows({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-col divide-y">{children}</div>
}
