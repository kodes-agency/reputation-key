// The Monthly portal goal's set sheet as its host opens it on the goal's own
// page, `/goals/portals` (PLAN PG-13): the page drawn as the route draws it,
// with the host's sheet and the page's title handed in as the goal's title. The
// card draws no title there, so a goal set from the sheet (from "Change" on the
// ready card, or "Set a number anyway" after a stop) leaves the focus on the
// page's h1 once the goal is read back; a sheet closed with nothing set gives
// it back to the door it was opened from. The Storybook Vitest project
// compiles no Tailwind, so the plays assert roles, calls and the focus.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalPageView } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalCommands } from '#/components/goals/portal-goal-card-ready'
import type { PortalGoalSheetCommands } from '#/components/goals/portal-goal-sheet'
import type { PortalGoalStopCommands } from '#/components/goals/portal-goal-stop-dialog'
import {
  PortalGoalPage,
  focusPortalGoalPageTitle,
} from '#/components/goals/portal-goal-page'
import {
  PAGE_NO_GOAL,
  PAGE_NO_GOAL_AFTER_A_STOP,
  PAGE_SCHEDULED,
  SEAVIEW,
  personName,
} from '#/components/goals/portal-goal-page.stories.fixtures'
import { portalGoalDoorShown, usePortalGoalSheet } from './-portal-goal-sheet-host'

const setMock = fn<PortalGoalCommands['setMonthlyPortalGoalFn']>(async () => ({
  programId: 'program-monthly',
}))
const onSetMock = fn<PortalGoalCommands['onSet']>(async () => undefined)
const changeNowMock = fn<PortalGoalSheetCommands['changeMonthlyPortalGoalNowFn']>()
const reviseMock = fn<PortalGoalSheetCommands['reviseMonthlyPortalGoalFn']>()
const stop = {
  stopMonthlyPortalGoalFn: fn(),
  onStopped: fn(async () => undefined),
  onRefused: fn(async () => undefined),
} satisfies PortalGoalStopCommands

type HarnessProps = Readonly<{
  page: PortalGoalPageView
  /** The page read again once a goal is set: the card is the goal now. */
  afterSet: PortalGoalPageView
}>

/** The goal's page with its set sheet, wired as the route wires them. */
function GoalPageWithItsSheet({ page: first, afterSet }: HarnessProps) {
  const [page, setPage] = useState(first)
  const set = {
    setMonthlyPortalGoalFn: setMock,
    changeMonthlyPortalGoalNowFn: changeNowMock,
    reviseMonthlyPortalGoalFn: reviseMock,
    onSet: async () => {
      await onSetMock()
      setPage(afterSet)
    },
  } satisfies PortalGoalCommands & PortalGoalSheetCommands
  const sheet = usePortalGoalSheet({
    propertyId: SEAVIEW.propertyId,
    card: page.card,
    commands: set,
    focusTitle: focusPortalGoalPageTitle,
    reread: async () => page.card,
    doorShown: portalGoalDoorShown(page.card, true, 'page'),
  })
  return (
    <>
      <PortalGoalPage
        propertyId={SEAVIEW.propertyId}
        propertyName={SEAVIEW.name}
        page={page}
        canCreatePortal
        canSeeResults
        canChange
        canStop
        commands={{ ...set, openSheet: sheet.open }}
        stop={stop}
        personName={personName}
      />
      {sheet.sheet}
    </>
  )
}

const meta: Meta<typeof GoalPageWithItsSheet> = {
  title: 'Goals/PortalGoalPageSheet',
  component: GoalPageWithItsSheet,
  parameters: { layout: 'padded' },
  args: { page: PAGE_NO_GOAL, afterSet: PAGE_SCHEDULED },
  beforeEach: () => {
    // Sonner's store outlives a story: no toast of a set here reaches another.
    toast.dismiss()
    setMock.mockClear()
    onSetMock.mockClear()
    return () => void toast.dismiss()
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Opens the sheet from a door of the card and waits for its title. */
async function openFrom(canvasElement: HTMLElement, door: string) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: door }))
  const sheet = await within(document.body).findByRole('dialog', {
    name: 'Monthly portal goal',
  })
  return within(sheet)
}

async function expectSheetClosed() {
  await waitFor(() =>
    expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
  )
}

const pageTitle = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('heading', { level: 1, name: 'Monthly portal goal' })

/** "Change" on the ready card, then Set: the page's title takes the focus. */
export const SetFromChange: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openFrom(canvasElement, 'Change')
    await userEvent.click(
      await sheet.findByRole('button', { name: 'Set 40 for November' }),
    )
    await expectSheetClosed()
    await expect(setMock).toHaveBeenCalledOnce()
    await expect(onSetMock).toHaveBeenCalledOnce()
    // The door went with the card: the goal is read back in its place.
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Change' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(pageTitle(canvasElement)).toHaveFocus())
  },
}

/** After a stop, "Set a number anyway" and a number of one's own: the page's title. */
export const SetANumberAnyway: Story = {
  args: { page: PAGE_NO_GOAL_AFTER_A_STOP },
  play: async ({ canvasElement }) => {
    const sheet = await openFrom(canvasElement, 'Set a number anyway')
    const box = sheet.getByRole('spinbutton')
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.type(box, '12')
    await userEvent.click(sheet.getByRole('button', { name: /^Set 12 for /u }))
    await expectSheetClosed()
    await expect(setMock.mock.calls[0]?.[0].data).toMatchObject({
      targetValue: 12,
      targetSource: 'own',
    })
    await waitFor(() => expect(pageTitle(canvasElement)).toHaveFocus())
  },
}

/** Cancel sets nothing, and the focus goes back to the door, not the title. */
export const CancelGoesBackToTheDoor: Story = {
  args: { page: PAGE_NO_GOAL_AFTER_A_STOP },
  play: async ({ canvasElement }) => {
    const sheet = await openFrom(canvasElement, 'Set a number anyway')
    await userEvent.click(sheet.getByRole('button', { name: 'Cancel' }))
    await expectSheetClosed()
    await expect(setMock).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'Set a number anyway' }),
      ).toHaveFocus(),
    )
    await expect(pageTitle(canvasElement)).not.toHaveFocus()
  },
}
