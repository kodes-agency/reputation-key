// The Monthly portal goal page's actions (PLAN PG-14; the page itself is in
// `portal-goal-page.stories.tsx`): "Change number" in the header and "Change the
// number" among the ways on in the page's last question, and the menu's other
// measure, all open the change sheet; Stop asks first, in the destructive tone (at
// 320 and 820 px too), then stops, says so and hands over to the route (which
// leaves for the Goals page); a goal that has not started is told it frees its
// month at once; a second Stop is said in place. A stopped goal takes no change
// and no second stop. The Storybook Vitest project compiles no Tailwind, so the
// plays assert words, roles and the calls.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import { PortalGoalPage } from './portal-goal-page'
import {
  PAGE_RUNNING,
  PAGE_SCHEDULED,
  PAGE_STOPPED,
  SEAVIEW,
  personName,
} from './portal-goal-page.stories.fixtures'

const stopMock = fn(async () => ({ programId: 'program-monthly' }))
const onStoppedMock = fn(async () => undefined)
const onRefusedMock = fn(async () => undefined)

const meta: Meta<typeof PortalGoalPage> = {
  title: 'Goals/PortalGoalPageActions',
  component: PortalGoalPage,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    page: PAGE_RUNNING,
    canCreatePortal: true,
    canSeeResults: true,
    canChange: true,
    canStop: true,
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn(), openSheet: fn() },
    stop: {
      stopMonthlyPortalGoalFn: stopMock,
      onStopped: onStoppedMock,
      onRefused: onRefusedMock,
    },
    personName,
  },
  beforeEach: () => {
    // Sonner's store outlives a story: no toast of a stop here reaches another.
    toast.dismiss()
    for (const mock of [stopMock, onStoppedMock, onRefusedMock]) mock.mockClear()
    return () => void toast.dismiss()
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** Opens the goal's menu and picks an item, which hands over once the menu has closed. */
async function pickFromMenu(canvas: Canvas, item: string) {
  await userEvent.click(
    canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
  )
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: item }),
  )
}

/** "Stop this goal…" from the menu: the confirmation it opens. */
async function openStop(canvasElement: HTMLElement) {
  await pickFromMenu(within(canvasElement), 'Stop this goal…')
  const dialog = await within(document.body).findByRole('alertdialog', {
    name: 'Stop the monthly portal goal?',
  })
  return { dialog, in: within(dialog) }
}

/** "Change number" and "Count scans instead" open the change sheet; the measure only from next month. */
export const Actions: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change number' }))
    await expect(args.commands.openSheet).toHaveBeenLastCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
    await pickFromMenu(canvas, 'Count scans instead…')
    await waitFor(() =>
      expect(args.commands.openSheet).toHaveBeenLastCalledWith({
        mode: 'change',
        measure: 'qualified_scans',
      }),
    )
    // The menu's trigger keeps the focus for the sheet to hand back.
    await expect(
      canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
    ).toHaveFocus()
  },
}

/** The way on in "What can you do this week?" opens the same sheet, with the usual under it. */
export const ChangeTheNumberFromTheBand: Story = {
  play: async ({ canvasElement, args }) => {
    const todo = within(
      within(canvasElement).getByRole('region', { name: 'What can you do this week?' }),
    )
    const change = todo.getByRole('button', { name: /^Change the number/u })
    await expect(change).toHaveTextContent('Your usual is about 34 a month.')
    await userEvent.click(change)
    await expect(args.commands.openSheet).toHaveBeenLastCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
  },
}

/** Without goal.update or goal.cancel the actions are not drawn, in the header or among the ways on. */
export const ActionsNotAllowed: Story = {
  args: { canChange: false, canStop: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Change the number/u })).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Monthly portal goal' }),
    ).toBeNull()
    // The way to the Portals' codes is not a change: it stays.
    await expect(canvas.getByRole('link', { name: /^Open your portals/u })).toBeVisible()
  },
}

/** Stop asks first; the focus stays in the dialog; then it stops, says so and hands over. */
export const StopDialog: Story = {
  decorators: [ToasterDecorator],
  play: async ({ canvasElement, args }) => {
    const { dialog, in: inDialog } = await openStop(canvasElement)
    await expect(
      inDialog.getByText(
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    )
    await userEvent.tab()
    await expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await userEvent.tab()
    await expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await userEvent.click(inDialog.getByRole('button', { name: 'Stop the goal' }))
    await expect(args.stop.stopMonthlyPortalGoalFn).toHaveBeenCalledWith({
      data: { propertyId: SEAVIEW.propertyId, programId: 'program-monthly' },
    })
    const said = await within(document.body).findByText('Monthly portal goal stopped')
    await waitFor(() => expect(said).toBeVisible())
    // The route leaves for the Goals page from here.
    await waitFor(() => expect(args.stop.onStopped).toHaveBeenCalledOnce())
  },
}

/** 320 px: the question, what happens and both buttons, in the destructive dialog. */
export const StopDialogOnANarrowPhone: Story = {
  play: async ({ canvasElement }) => {
    const { in: inDialog } = await openStop(canvasElement)
    await expect(
      inDialog.getByText(
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      ),
    ).toBeVisible()
    await expect(inDialog.getByRole('button', { name: 'Keep the goal' })).toBeVisible()
    await expect(inDialog.getByRole('button', { name: 'Stop the goal' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const StopDialogOnATablet: Story = {
  ...StopDialogOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

/** "Keep the goal" stops nothing, and the focus goes back to the menu's trigger. */
export const StopKept: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const { dialog, in: inDialog } = await openStop(canvasElement)
    await userEvent.click(inDialog.getByRole('button', { name: 'Keep the goal' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await expect(args.stop.stopMonthlyPortalGoalFn).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
      ).toHaveFocus(),
    )
  },
}

/** A goal that has not started frees its month at once. */
export const StopScheduled: Story = {
  args: { page: PAGE_SCHEDULED },
  play: async ({ canvasElement, args }) => {
    const { in: dialog } = await openStop(canvasElement)
    await expect(
      dialog.getByText(
        'November has not started, so nothing has counted yet. You can set a new goal straight away.',
      ),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Stop the goal' }))
    await waitFor(() => expect(args.stop.onStopped).toHaveBeenCalledOnce())
  },
}

/** F-5: stopped a moment ago elsewhere. The dialog says so and the page is read again. */
export const StopAlreadyStopped: Story = {
  args: {
    stop: {
      stopMonthlyPortalGoalFn: fn(async () => {
        throw new ServerFunctionError(
          'GoalProgramError',
          'invalid_transition',
          'invalid_transition',
          409,
        )
      }),
      onStopped: fn(async () => undefined),
      onRefused: fn(async () => undefined),
    },
  },
  play: async ({ canvasElement, args }) => {
    const { in: dialog } = await openStop(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Stop the goal' }))
    await expect(
      await dialog.findByText('This goal was already stopped. Here is the latest.'),
    ).toBeVisible()
    await expect(args.stop.onRefused).toHaveBeenCalledOnce()
    await expect(args.stop.onStopped).not.toHaveBeenCalled()
  },
}

/** A stopped goal takes no change and no second stop: no actions; the next goal from December. */
export const StoppedHasNoActions: Story = {
  args: { page: PAGE_STOPPED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Change the number/u })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^More actions/u })).toBeNull()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Set a goal from December' }),
    )
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      measure: 'portal_rating_count',
      month: '2026-12',
    })
  },
}
