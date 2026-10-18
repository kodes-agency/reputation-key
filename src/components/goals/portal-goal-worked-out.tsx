// "How we worked this out" for the Monthly portal goal's number (copy deck
// W-1…W-5): which Portals it stands on and what they brought in, the sum for
// the month, each Portal's count over its live days (and the new ones, which
// join once they have 2 weeks), and how the measure counts. It opens on
// request from the shared `ExplainTrigger`, takes the focus, and closes on
// Escape or its own Close with the focus back on the trigger. 520 px on a
// desktop, the screen less its gutters on a phone.
import { useState } from 'react'
import { X } from 'lucide-react'
import type { PortalGoalOffer } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { IconButton } from '#/components/ui/icon-button'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { WORKED_OUT_TITLE, workedOutWords } from './portal-goal-offer-words'

/** The popover's width on a desktop; a phone takes the screen less its gutters. */
const POPOVER_WIDTH = 520
const PHONE_WIDTH = 'calc(100vw - 2rem)'

export function PortalGoalWorkedOut({ offer }: Readonly<{ offer: PortalGoalOffer }>) {
  const words = workedOutWords(offer)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* In the sentence it explains, like a glossary term: no tap height of its own. */}
      <ExplainTrigger>{WORKED_OUT_TITLE}</ExplainTrigger>
      <PopoverContent
        side="top"
        aria-label={WORKED_OUT_TITLE}
        className="relative flex flex-col gap-2 text-sm text-muted-foreground"
        style={{ width: POPOVER_WIDTH, maxWidth: PHONE_WIDTH }}
      >
        <IconButton
          label="Close"
          size="icon-sm"
          tooltip={false}
          className="absolute top-3 right-3"
          onClick={() => setOpen(false)}
        >
          <X aria-hidden="true" />
        </IconButton>
        <p className="pe-12 font-semibold text-foreground">{WORKED_OUT_TITLE}</p>
        {words.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <ul className="flex flex-col gap-1 text-foreground">
          {words.rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
        <p>{words.foot}</p>
      </PopoverContent>
    </Popover>
  )
}
