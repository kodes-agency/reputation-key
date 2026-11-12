import { useCapabilities } from '#/shared/hooks/useCapabilities'
// Keep drafts above the responsive frame so rotation preserves them, and mount afresh
// per opening. Use the read's filtered subjects, including private-rating eligibility.
// Stale refusals refresh offers; partial saves retain per-row failures. Pending saves
// prevent dismissal.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  AddPortalGoalRequest,
  AddPortalGoalsRequest,
  AddPortalGoalsResult,
  PortalGoalAddOptions,
} from '#/contexts/reporting/monthly-goals/contracts'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import {
  goalRefusalCode,
  withGoalRefusals,
} from '../../../../components/goals/goal-refusal'
import { GoalSheetFrame } from '../../../../components/goals/goal-sheet-frame'
import {
  PortalGoalAddBody,
  stepControl,
  type PortalGoalAddPlace,
} from './portal-goal-add-body'
import { eachDraftOf, eachToast } from './portal-goal-add-each-view'
import {
  staffGoalOptions,
  addedSubjectKeys,
  addedToast,
  type PortalGoalAddStep,
} from './portal-goal-add-view'
import { PORTAL_GOAL_BEHIND } from './portal-goal-sheet-refusals'

export type PortalGoalAddCommands = Readonly<{
  addPortalGoalFn: (input: Readonly<{ data: AddPortalGoalRequest }>) => Promise<unknown>
  addPortalGoalsFn: (
    input: Readonly<{ data: AddPortalGoalsRequest }>,
  ) => Promise<AddPortalGoalsResult>
  /**
   * Goals were added for these subjects (`portal:<id>`, `portal_group:<id>`),
   * or a refusal says the read is behind (none): read the goals again.
   */
  onAdded: (subjects: readonly string[]) => Promise<void>
}>

/** Where the sheet opens: a step, and the Portal or group an address named. */
export type PortalGoalAddOpening = Readonly<{
  step: PortalGoalAddStep
  subject: string | null
}>

export type PortalGoalAddSheetProps = Readonly<{
  open: boolean
  /** Cancel, Escape, the overlay or the corner close. */
  onOpenChange: (open: boolean) => void
  /** A goal was added and the goals read again: the sheet is done. */
  onSettled: () => void
  propertyId: string
  options: PortalGoalAddOptions
  opening: PortalGoalAddOpening
  commands: PortalGoalAddCommands
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
}>

function placeOf(opening: PortalGoalAddOpening): PortalGoalAddPlace {
  switch (opening.step) {
    case 'choose':
      return { step: 'choose', picked: null }
    case 'portal':
    case 'group':
      return { step: opening.step, picked: opening.subject }
    case 'each':
    case 'average':
      return { step: opening.step }
  }
}

/** Opening: the focus goes to the step's first control. */
function focusTheStep(event: Event): void {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const first = stepControl(content)
  if (first === null) return
  event.preventDefault()
  first.focus()
}

/** The two commands, each sent once however often Set is pressed, and what follows. */
function useAddCommands(
  props: PortalGoalAddSheetProps,
  onSomeNotSaved: (portalIds: ReadonlySet<string>) => void,
) {
  const { commands, onSettled } = props
  const sending = useRef(false)
  const [error, setError] = useState<unknown>(null)
  const settle = async (message: string, subjects: readonly string[]) => {
    toast.success(message)
    await commands.onAdded(subjects)
    onSettled()
  }
  const behind = (error: unknown) => {
    setError(error)
    if (PORTAL_GOAL_BEHIND.has(goalRefusalCode(error) ?? '')) void commands.onAdded([])
  }
  const one = useActionMutation(withGoalRefusals(commands.addPortalGoalFn), {
    onSuccess: (_output, { data }) =>
      settle(addedToast(props.options, data), addedSubjectKeys(data.subject)),
    onError: behind,
  })
  const each = useActionMutation(withGoalRefusals(commands.addPortalGoalsFn), {
    onSuccess: async ({ outcomes }) => {
      const saved = outcomes.flatMap((outcome) =>
        outcome.saved
          ? addedSubjectKeys({ kind: 'portal', portalId: outcome.portalId })
          : [],
      )
      const notSaved = new Set(
        outcomes.filter((outcome) => !outcome.saved).map(({ portalId }) => portalId),
      )
      if (notSaved.size === 0) return settle(eachToast(saved.length), saved)
      if (saved.length > 0) toast.success(eachToast(saved.length))
      await commands.onAdded(saved)
      onSomeNotSaved(notSaved)
    },
    onError: behind,
  })
  const once = (send: () => Promise<unknown>) => {
    if (sending.current) return
    sending.current = true
    setError(null)
    onSomeNotSaved(new Set())
    void send()
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  return {
    sendOne: (data: AddPortalGoalRequest) => once(() => one({ data })),
    sendEach: (data: AddPortalGoalsRequest) => once(() => each({ data })),
    pending: one.isPending || each.isPending,
    error,
  }
}

export function PortalGoalAddSheet(props: PortalGoalAddSheetProps) {
  const { all } = useCapabilities()
  const options = staffGoalOptions(props.options, all.includes('staff.accounts'))
  const { propertyId } = props
  const [place, setPlace] = useState(() => placeOf(props.opening))
  const [each, setEach] = useState(() => eachDraftOf(options))
  const [box, setBox] = useState('')
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const { sendOne, sendEach, pending, error } = useAddCommands(props, setFailed)
  return (
    <GoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      marker="data-portal-goal-add"
      onOpenAutoFocus={focusTheStep}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalAddBody
          propertyId={propertyId}
          options={options}
          place={place}
          each={each}
          box={box}
          failed={failed}
          small={phone}
          pending={pending}
          onPlace={setPlace}
          onEach={setEach}
          onBox={setBox}
          onSendOne={(data) => sendOne({ propertyId, ...data })}
          onSendEach={(data) => sendEach({ propertyId, ...data })}
          error={<DialogErrorBanner error={error} />}
          footer={(back, primary) => (
            <DialogFooter className="mt-auto">
              {back === null ? (
                <DialogCancel />
              ) : (
                <Button type="button" variant="outline" disabled={pending} onClick={back}>
                  Back
                </Button>
              )}
              <Button
                type="submit"
                disabled={primary.disabled}
                pending={pending}
                pendingLabel="Saving…"
                className="whitespace-normal"
              >
                {primary.label}
              </Button>
            </DialogFooter>
          )}
        />
      )}
    </GoalSheetFrame>
  )
}
