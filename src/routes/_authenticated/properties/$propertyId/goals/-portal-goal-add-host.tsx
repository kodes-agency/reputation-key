// Opens "Add a portal goal" (PLAN PG-20; copy deck M-1…M-14): from its door at
// the foot of the Goals page's Portal goals section, in place, and from the
// Monthly portal goal's page, where an old link's address (`?add=…`) also opens
// it on the step it named. The sheet is a chunk of its own, fetched while its
// door is on screen, and it works from the add read (`portalGoalAddQuery`,
// primed by both pages' loaders), so the door is drawn only when the read
// offers something to add (the M-rule) and never pops in after the section. A
// fresh sheet (new drafts, no old refusal) is mounted for every opening.
//
// No Radix trigger opens it, so the host remembers what had the focus and
// returns it there on closing, or to the page's goal title when that is gone
// (`useFocusReturn`, as the set sheet's host does). An added goal marks every
// Portal-goal read stale, never the Google rating goal's.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import type {
  PortalGoalAddCommands,
  PortalGoalAddOpening,
} from '#/components/goals/portal-goal-add-sheet'
import { portalGoalAddOffered } from '#/components/goals/portal-goal-add-view'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  markPortalGoalReadsStale,
  portalGoalAddCommands,
  portalGoalAddQuery,
} from './-portal-goal-queries'
import { useFocusReturn } from './-portal-goal-sheet-host'

const loadSheet = () => import('#/components/goals/portal-goal-add-sheet')
const PortalGoalAddSheet = lazy(() =>
  loadSheet().then((module) => ({ default: module.PortalGoalAddSheet })),
)

type Opening = PortalGoalAddOpening &
  Readonly<{
    /** The read it opened on, for when the read is being read again. */
    options: PortalGoalAddOptions
    open: boolean
    key: number
  }>

type Input = Readonly<{
  propertyId: string
  /** The add read as it is now; undefined while it is not read (or failed). */
  options: PortalGoalAddOptions | undefined
  /** Puts the focus on the page's goal title, for a door that is gone. */
  focusTitle: () => void
  /** Where an address asked the sheet to open, on arriving at the page. */
  initial?: PortalGoalAddOpening | null
  /** The sheet closed: an address that opened it is cleared. */
  onClosed?: () => void
}>

/** The add sheet: `open` opens it on a step, and `sheet` is the element the page draws. */
export function usePortalGoalAdd(input: Input) {
  const { propertyId, options } = input
  const queryClient = useQueryClient()
  const focus = useFocusReturn(input.focusTitle)
  const [opening, setOpening] = useState<Opening | null>(() =>
    input.initial && options ? { ...input.initial, options, open: true, key: 1 } : null,
  )
  const offered = options !== undefined && portalGoalAddOffered(options)
  useEffect(() => {
    if (offered) void loadSheet()
  }, [offered])
  const open = (at: PortalGoalAddOpening) => {
    if (options === undefined) return
    focus.remember()
    setOpening((current) => ({
      ...at,
      options,
      open: true,
      key: (current?.key ?? 0) + 1,
    }))
  }
  const setOpen = (next: boolean) => {
    setOpening((current) => (current === null ? null : { ...current, open: next }))
    if (!next) input.onClosed?.()
  }
  const commands: PortalGoalAddCommands = {
    addPortalGoalFn: portalGoalAddCommands.addPortalGoal,
    // The sheet's rows are read-only; the server function takes its own copy.
    addPortalGoalsFn: ({ data }) =>
      portalGoalAddCommands.addPortalGoals({ data: { ...data, items: [...data.items] } }),
    onAdded: () => markPortalGoalReadsStale(queryClient, propertyId),
  }
  const sheet: ReactNode =
    opening === null ? null : (
      <Suspense fallback={null}>
        <PortalGoalAddSheet
          key={opening.key}
          open={opening.open}
          onOpenChange={setOpen}
          onSettled={() => setOpen(false)}
          propertyId={propertyId}
          // The read as it is now (a goal added moves its rows); while it is
          // read again, the one the sheet opened on.
          options={options ?? opening.options}
          opening={opening}
          commands={commands}
          onCloseAutoFocus={focus.returnFocus(opening.open)}
        />
      </Suspense>
    )
  return { offered, open, sheet }
}

/** M-1: the door, a quiet link-like button, drawn only when there is something to add. */
export function PortalGoalAddButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <Button
      type="button"
      variant="link"
      size="inline"
      className="self-start text-sm"
      onClick={onOpen}
    >
      Add a portal goal
    </Button>
  )
}

/**
 * The Goals page's door, at the foot of the Portal goals section: it reads what
 * the sheet offers (primed by the loader) for someone who may add a goal, and
 * opens the sheet in place.
 */
export function PortalGoalAddDoor({
  propertyId,
  focusTitle,
}: Readonly<{ propertyId: string; focusTitle: () => void }>) {
  const { can } = usePermissions()
  const read = useQuery({
    ...portalGoalAddQuery(propertyId),
    enabled: can('goal.create'),
    retry: false,
  })
  const add = usePortalGoalAdd({ propertyId, options: read.data, focusTitle })
  return (
    <>
      {add.offered ? (
        <PortalGoalAddButton onOpen={() => add.open({ step: 'choose', subject: null })} />
      ) : null}
      {add.sheet}
    </>
  )
}
