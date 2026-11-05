import { Target } from 'lucide-react'
import type { PortalGoalLineView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { InlineLink } from '#/components/ui/inline-link'
import { resultsLineWords } from './portal-goal-results-line-view'

type Props = Readonly<{
  line: PortalGoalLineView | null
  /** The Portal whose tab this is: "Reception’s 13 private ratings". */
  portalName: string
  propertyId: string
}>

export function PortalGoalResultsLine({ line, portalName, propertyId }: Props) {
  const words = resultsLineWords(line, portalName)
  if (words === null) return null
  return (
    <p
      data-slot="portal-goal-results-line"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm"
    >
      <Target aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{words.text}</span>
      {words.goal.kind === 'own' ? (
        <InlineLink
          to="/properties/$propertyId/goals/$goalId"
          params={{ propertyId, goalId: words.goal.programId }}
          // Set in the line's sentence: underlined, so it reads as a link in either theme.
          underline="always"
        >
          {words.open}
        </InlineLink>
      ) : (
        <InlineLink
          to="/properties/$propertyId/goals/portals"
          params={{ propertyId }}
          underline="always"
        >
          {words.open}
        </InlineLink>
      )}
    </p>
  )
}
