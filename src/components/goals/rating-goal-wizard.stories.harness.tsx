// What the Google rating goal wizard's stories share: a page with the one door
// the wizard opens from (a fresh wizard for every opening, the focus handed
// back to the door as the page's host does), the Portal goals title the done
// screen leads to, the command mocks, and the steps a play takes. Story-only:
// the `.stories.` segment keeps it out of the bundles.
import { useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from '#/components/ui/button'
import { RatingGoalWizard, type RatingGoalWizardProps } from './rating-goal-wizard'
import { PORTAL_GOALS_TITLE_ID } from './rating-goal-wizard-done'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'
import { FIXTURE_GOAL_ID, FIXTURE_PROPERTY_ID } from './rating-goal.stories.fixtures'
import { HARBORLINE, setupViewOf } from './rating-goal-setup.stories.fixtures'

type SetFn = RatingGoalWizardProps['setRatingGoalFn']
type ChangeFn = RatingGoalWizardProps['changeRatingGoalFn']

export const setMock = fn<SetFn>(async () => ({ goalId: FIXTURE_GOAL_ID, version: 1 }))
export const changeMock = fn<ChangeFn>(async () => ({
  goalId: FIXTURE_GOAL_ID,
  version: 4,
}))

export const refusal = (code: string) =>
  new ServerFunctionError('RatingGoalError', code, code, 409)

export const read = (data: RatingGoalSetupView | undefined) => ({
  data,
  failed: false,
  retrying: false,
  retry: () => undefined,
})

export type HarnessProps = Partial<RatingGoalWizardProps> &
  Readonly<{ intent: RatingGoalWizardIntent }>

/** A page with the one door the wizard opens from; a fresh wizard for every opening. */
export function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const door = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={door}
        onClick={() => {
          setOpen(true)
          setKey((last) => last + 1)
        }}
      >
        Open the wizard
      </Button>
      <RatingGoalWizard
        key={key}
        open={open}
        onOpenChange={setOpen}
        propertyId={FIXTURE_PROPERTY_ID}
        propertyName="Harborline Suites"
        setup={read(setupViewOf(HARBORLINE))}
        portalNextStep="see"
        setRatingGoalFn={setMock}
        changeRatingGoalFn={changeMock}
        // As the page's host does: no trigger, so the focus is handed back here.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!open) door.current?.focus()
        }}
        {...props}
      />
    </>
  )
}

/** Where the page was asked to go while the story ran: the path of each address. */
export const navigations = fn<(pathname: string) => void>()

/**
 * The Goals page's Portal goals title, where "See your portal goal" lands, as
 * the page draws it. The story's router has no Goals page, so the address the
 * link asks for is recorded and not followed: the story stays on screen.
 */
export function PortalGoalsLanding() {
  useBlocker({
    shouldBlockFn: ({ next }) => {
      navigations(next.pathname)
      return true
    },
    enableBeforeUnload: false,
  })
  return (
    <h2 id={PORTAL_GOALS_TITLE_ID} tabIndex={-1}>
      Portal goals
    </h2>
  )
}

export const clearMocks = () => {
  setMock.mockClear()
  changeMock.mockClear()
  navigations.mockClear()
}

/** Opens the wizard and waits for its title. */
export async function openWizard(canvasElement: HTMLElement, title = 'Your Google goal') {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open the wizard' }),
  )
  const dialog = within(await within(document.body).findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('heading', { name: title })).toBeVisible())
  return dialog
}

export type Dialog = Awaited<ReturnType<typeof openWizard>>

/** Waits for the wizard to close and the focus to land on what `target` finds. */
export async function closesOnto(target: () => HTMLElement) {
  await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(target()).toHaveFocus())
}

/**
 * A click on `target` with the keys in `held` down, as the page receives it.
 * What the browser itself would do with it after the page (a new tab, a new
 * window, a download) is held back, so the story stays on screen.
 */
export async function clickHolding(target: HTMLElement, held: MouseEventInit) {
  const holdBack = (event: Event) => event.preventDefault()
  document.addEventListener('click', holdBack)
  try {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...held }),
    )
  } finally {
    document.removeEventListener('click', holdBack)
  }
  // React has drawn whatever the click asked for by the next frame.
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

/** The goal's numeral: its value and its sentence. */
export const numeral = (dialog: Dialog) =>
  dialog.getByRole('spinbutton', { name: 'Goal on Google' })

/** The goal's polite live region (off while the number has the focus). */
export const goalLive = (): Element | null =>
  document.body.querySelector('[data-slot="rating-goal-live"]')

/** The line under the goal, as one text, its parts a dot apart. */
export const statusLine = (): string =>
  document.body
    .querySelector('[data-slot="rating-goal-status"]')
    ?.textContent?.replace(/·/gu, ' · ')
    .replace(/\s+/gu, ' ')
    .trim() ?? ''

/** Presses "Aim for {T}" and checks what is sent: target, average and pace in tenths. */
export async function aimsFor(
  dialog: Dialog,
  targetTenths: number,
  qualityTenths: number,
  paceTenthsPerWeek: number,
) {
  const target = (targetTenths / 10).toFixed(1)
  await userEvent.click(dialog.getByRole('button', { name: `Aim for ${target}` }))
  await waitFor(() =>
    expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'climb',
        targetTenths,
        qualityTenths,
        paceTenthsPerWeek,
      },
    }),
  )
}
