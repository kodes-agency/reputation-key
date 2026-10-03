// The goal header's status actions: Pause or Resume while a goal runs, and End
// goal for any goal that has not ended. Ending is final (an ended goal cannot be
// resumed or revised), so it asks first; pausing is undone by resuming and does
// not.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { GoalStatusActions } from './goal-status-actions'

const meta: Meta<typeof GoalStatusActions> = {
  title: 'Goals/GoalStatusActions',
  component: GoalStatusActions,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    goalName: 'More private ratings',
    status: 'active',
    pending: false,
    onChange: fn(),
  },
}
export default meta
type Story = StoryObj<typeof GoalStatusActions>

async function openEndDialog(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'End goal' }))
  const dialog = within(canvasElement.ownerDocument.body)
  const alert = await dialog.findByRole('alertdialog')
  await waitFor(() => expect(alert).toBeVisible())
  return dialog
}

/** Ending asks first, names the goal, and runs only on confirm. */
export const EndAsksFirst: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openEndDialog(canvasElement)
    expect(args.onChange).not.toHaveBeenCalled()
    expect(
      dialog.getByRole('heading', { name: 'End “More private ratings”?' }),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'End goal' }))
    expect(args.onChange).toHaveBeenCalledTimes(1)
    expect(args.onChange).toHaveBeenCalledWith('ended')
  },
}

export const EndAsksFirstLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement, args }) => {
    await openEndDialog(canvasElement)
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const KeepGoal: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openEndDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep goal' }))
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

/** Pausing is undone by resuming, so it acts at once. */
export const PauseActsAtOnce: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Pause' }))
    expect(args.onChange).toHaveBeenCalledWith('paused')
  },
}

export const Paused: Story = {
  args: { status: 'paused' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }))
    expect(args.onChange).toHaveBeenCalledWith('active')
    expect(canvas.getByRole('button', { name: 'End goal' })).toBeEnabled()
  },
}

/** A goal that has not started yet can only be ended, never paused. */
export const Scheduled: Story = {
  args: { status: 'scheduled' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(canvas.getAllByRole('button')).toHaveLength(1)
    expect(canvas.getByRole('button', { name: 'End goal' })).toBeEnabled()
  },
}

export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'End goal' })).toBeDisabled()
  },
}
