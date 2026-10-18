// "Month by month" on the Monthly portal goal's page (copy deck P-8, P-9): each
// month of the goal, and of the goals it took over from, newest first, as a
// chip that opens its facts: the figure and the result, the day the figure is
// final, the month's own number and any correction. Met has a check in the
// positive ink; not met is neutral, never red; a month still counting or being
// read is dashed. The words are `stripChips`'.
import { useId } from 'react'
import { Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { SectionTitle } from '#/components/ui/section-title'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type { PortalGoalStripChip } from './portal-goal-page-view'

/** The popover's width on a desktop; a phone takes the screen less its gutters. */
const POPOVER_WIDTH = 320
const PHONE_WIDTH = 'calc(100vw - 2rem)'

const STRIP_TITLE = 'Month by month'

function MonthChip({ chip }: Readonly<{ chip: PortalGoalStripChip }>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          touch
          aria-label={chip.label}
          data-slot="portal-goal-month-chip"
          data-outcome={chip.open ? 'open' : chip.met ? 'met' : 'closed'}
          className={cn('tabular-nums', chip.open && 'border-dashed')}
        >
          {chip.met ? (
            <Check
              aria-hidden="true"
              className={cn('size-4 shrink-0', TONE_INK.positive)}
            />
          ) : null}
          <span>{chip.text}</span>
          {chip.suffix === null ? null : (
            <span className="text-muted-foreground">· {chip.suffix}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={chip.title}
        className="flex flex-col gap-1 text-sm text-muted-foreground"
        style={{ width: POPOVER_WIDTH, maxWidth: PHONE_WIDTH }}
      >
        <p className="font-semibold text-foreground">{chip.title}</p>
        {chip.lines.map((line) => (
          <p key={line} className="tabular-nums">
            {line}
          </p>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function PortalGoalMonthStrip({
  chips,
}: Readonly<{ chips: readonly PortalGoalStripChip[] }>) {
  const headingId = useId()
  if (chips.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionTitle id={headingId}>{STRIP_TITLE}</SectionTitle>
      <ol aria-label={STRIP_TITLE} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <MonthChip chip={chip} />
          </li>
        ))}
      </ol>
    </section>
  )
}
