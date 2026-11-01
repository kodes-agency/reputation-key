// Every month's result of the Portal goals (2026-11-01, ADR 0068; it replaces the
// matrix's table a month): each goal with its months against their numbers, then one
// row a month in a manager's words. When a figure was final and who set the number
// are one tap away, on the row itself. The words are `portal-goal-results-list-view.ts`'.
import { Check, ChevronRight } from 'lucide-react'
import type { GoalResultsMatrix } from '#/contexts/reporting/application/public-api'
import { RowButton } from '#/components/ui/button-layouts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { GoalColumns } from './goal-columns'
import {
  resultGoals,
  type ResultGoal,
  type ResultRow,
  type ResultVerdict,
} from './portal-goal-results-list-view'

type Props = Readonly<{
  matrix: GoalResultsMatrix
  /** The instant the page was opened, which decides whether a day prints its year. */
  now: Date
  /** Who changed a month's number, by name; null where the directory cannot say. */
  personName: (userId: string) => string | null
}>

function Verdict({ verdict }: Readonly<{ verdict: ResultVerdict }>) {
  if (verdict.kind === 'met') {
    return (
      <span
        className={cn('inline-flex items-center gap-1 font-medium', TONE_INK.positive)}
      >
        <Check aria-hidden="true" className="size-4" />
        {verdict.text}
      </span>
    )
  }
  return <span className="text-muted-foreground">{verdict.text}</span>
}

const MONTH_OR_FIGURE = { flex: '1 1 8.5rem' } as const

const ROW_COLUMNS = {
  gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.5fr) 1rem',
} as const

function Month({ row }: Readonly<{ row: ResultRow }>) {
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <RowButton variant="ghost" className="group font-normal">
            <span className="grid w-full items-center gap-x-3" style={ROW_COLUMNS}>
              {/* The month and its figure: side by side, or one under the other without the room. */}
              <span className="flex min-w-0 flex-wrap gap-x-3">
                <span className="font-medium" style={MONTH_OR_FIGURE}>
                  {row.month}
                </span>
                <span className="whitespace-nowrap tabular-nums" style={MONTH_OR_FIGURE}>
                  {row.result}
                </span>
              </span>
              <Verdict verdict={row.verdict} />
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
              />
            </span>
          </RowButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 pb-3 text-sm text-muted-foreground">
            {row.details.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function Goal({ goal }: Readonly<{ goal: ResultGoal }>) {
  return (
    <Card data-slot="portal-goal-results-goal" className="gap-3">
      <CardHeader>
        <CardTitle as="h2">
          {goal.title}
          {goal.subject === null ? null : (
            <span className="font-normal text-muted-foreground"> · {goal.subject}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-3">
        {goal.bars === null ? null : (
          <GoalColumns
            caption={goal.bars.caption}
            columns={goal.bars.columns}
            label="Each month; use left and right arrows to read each one."
            hint="Hover or tap a bar to read that month."
          />
        )}
        {goal.measures.map((measure) => (
          <div key={measure.metric} className="flex flex-col">
            {measure.title === null ? null : (
              <p className="border-b pb-1 text-sm text-muted-foreground">
                {measure.title}
              </p>
            )}
            <ul
              aria-label={measure.title ?? `Each month of ${goal.title}`}
              className="flex flex-col divide-y"
            >
              {measure.rows.map((row) => (
                <Month key={row.key} row={row} />
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PortalGoalResultsList({ matrix, now, personName }: Props) {
  return (
    <>
      {resultGoals(matrix, { now, personName }).map((goal) => (
        <Goal key={goal.key} goal={goal} />
      ))}
    </>
  )
}
