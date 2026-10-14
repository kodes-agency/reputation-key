// Opens the Google rating goal wizard from a page: the Goals page (set a goal,
// the next one, or one to keep) and the goal's detail page (change it). The
// wizard is a chunk of its own, fetched when a door to it is on screen; the
// setup read it works from is the one the Goals page's empty state reads, and a
// fresh wizard (new state, no old refusal) is mounted for every opening.
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import type { RegionRead } from '#/components/goals/rating-goal-section'
import type { RatingGoalWizardIntent } from '#/components/goals/rating-goal-wizard-view'
import { ratingGoalCommands, ratingGoalSetupQuery } from './-rating-goal-queries'

const loadWizard = () => import('#/components/goals/rating-goal-wizard')
const RatingGoalWizard = lazy(() =>
  loadWizard().then((module) => ({ default: module.RatingGoalWizard })),
)

/** Fetch the wizard's chunk ahead of the click, while a door to it is on screen. */
export const preloadRatingGoalWizard = (): void => void loadWizard()

/** A query as a region draws it, its failure kept on screen while a retry reads. */
export function regionRead<T>(query: UseQueryResult<T>): RegionRead<T> {
  return {
    data: query.data,
    failed: hasFailed(query),
    retrying: isRetrying(query),
    retry: () => void query.refetch(),
  }
}

type Opening = Readonly<{ intent: RatingGoalWizardIntent; open: boolean; key: number }>

/**
 * The wizard of one page: `start` opens it for an intent, and `wizard` is the
 * element the page draws (nothing until it is first opened). The setup is read
 * while the wizard is open, or all along where the page asks (`readSetup`).
 */
export function useRatingGoalWizard(
  propertyId: string,
  options: Readonly<{ hasPortals: boolean; readSetup?: boolean }>,
): Readonly<{
  start: (intent: RatingGoalWizardIntent) => void
  wizard: ReactNode
  /** The setup read the wizard works from, for a page that also shows from it. */
  setup: UseQueryResult<RatingGoalSetupView>
}> {
  const [opening, setOpening] = useState<Opening | null>(null)
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    enabled: opening?.open === true || options.readSetup === true,
    retry: false,
  })
  const start = (intent: RatingGoalWizardIntent) =>
    setOpening((current) => ({ intent, open: true, key: (current?.key ?? 0) + 1 }))
  const wizard =
    opening === null ? null : (
      <Suspense fallback={null}>
        <RatingGoalWizard
          key={opening.key}
          open={opening.open}
          onOpenChange={(open) =>
            setOpening((current) => (current === null ? null : { ...current, open }))
          }
          propertyId={propertyId}
          intent={opening.intent}
          setup={regionRead(setup)}
          hasPortals={options.hasPortals}
          setRatingGoalFn={ratingGoalCommands.setRatingGoal}
          changeRatingGoalFn={ratingGoalCommands.changeRatingGoal}
        />
      </Suspense>
    )
  return { start, wizard, setup }
}
