import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ToasterDecorator } from '../../../../../.storybook/ToasterDecorator'
import { SEAVIEW } from './portal-goal-page.stories.fixtures'
import {
  SEVERAL_RUNNING,
  SEVERAL_STOPPED,
} from './portal-goal-single-page.stories.fixtures'
import { outline } from './portal-goal.stories.play'
import { PortalGoalSeveralPage } from './portal-goal-several-page'

const stopMock = fn(async () => ({ programId: 'program-several' }))
const onStoppedMock = fn(async () => undefined)
const onRefusedMock = fn(async () => undefined)
const stop = {
  stopMonthlyPortalGoalFn: stopMock,
  onStopped: onStoppedMock,
  onRefused: onRefusedMock,
}

const meta = {
  title: 'Goals/PortalGoalSinglePage',
  component: PortalGoalSeveralPage,
  parameters: { layout: 'padded', viewport: { defaultViewport: 'desktopManager' } },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    view: SEVERAL_RUNNING,
    canStop: true,
    stop,
  },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    toast.dismiss()
    for (const mock of [stopMock, onStoppedMock, onRefusedMock]) mock.mockClear()
    return () => void toast.dismiss()
  },
} satisfies Meta<typeof PortalGoalSeveralPage>
export default meta
type Story = StoryObj<typeof meta>

async function expectToast(text: string) {
  const said = await within(document.body).findByText(text)
  await waitFor(() => expect(said).toBeVisible())
}

/** Several subjects keep their names, progress and Stop. */
export const SeveralSubjects: Story = {
  render: (args) => (
    <PortalGoalSeveralPage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={SEVERAL_RUNNING}
      canStop={args.canStop}
      stop={args.stop}
    />
  ),
  parameters: { viewport: { defaultViewport: 'tablet' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = 'Rooms (group) and 2 more · portal goal'
    await expect(outline(canvasElement)).toEqual([`h1 ${title}`])
    await expect(
      canvas.getByText('Private ratings from Rooms (group) and 2 more at Seaview Hotel.'),
    ).toBeVisible()
    await expect(canvas.getByText('3 subjects · 1 below pace')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await userEvent.click(
      canvas.getByRole('button', { name: `More actions for ${title}` }),
    )
    const body = within(document.body)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Stop this goal…' }))
    const dialog = await body.findByRole('alertdialog', {
      name: 'Stop this portal goal?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop the goal' }))
    await expect(stopMock).toHaveBeenCalledWith({
      data: { propertyId: SEAVIEW.propertyId, programId: 'program-several' },
    })
    await expectToast('Portal goal stopped')
    await waitFor(() => expect(onStoppedMock).toHaveBeenCalledOnce())
  },
}

/** The same, stopped: it says so, and takes no action. */
export const SeveralStopped: Story = {
  render: (args) => (
    <PortalGoalSeveralPage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={SEVERAL_STOPPED}
      canStop={args.canStop}
      stop={args.stop}
    />
  ),
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped on Nov 12.')).toBeVisible()
    await expect(canvas.queryByText(/below pace/u)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^More actions/u })).toBeNull()
  },
}
