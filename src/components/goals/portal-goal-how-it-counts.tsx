// "How this goal counts" on the Monthly portal goal's page (copy deck P-13,
// P-14): closed until asked, in what the goal counts now, on the Property's
// time; on a Portal's or a group's own page, where it counts (PLAN PG-21). The
// words are `howItCountsWords`'.
import { ChevronRight } from 'lucide-react'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { HOW_IT_COUNTS_TITLE, howItCountsWords } from './portal-goal-page-view'

type Props = Readonly<{
  measure: PortalGoalMeasure
  timezone: string
  /** Where the ratings count: a goal's own Portal or group; else any of the Property's. */
  where?: string
}>

export function PortalGoalHowItCounts({ measure, timezone, where }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="group h-auto w-full justify-start gap-3 px-1 py-3 text-left font-normal"
        >
          <ChevronRight
            aria-hidden="true"
            className="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
          />
          <span className="font-medium">{HOW_IT_COUNTS_TITLE}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="px-1 pb-3 text-sm text-muted-foreground">
          {howItCountsWords(measure, timezone, where)}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
