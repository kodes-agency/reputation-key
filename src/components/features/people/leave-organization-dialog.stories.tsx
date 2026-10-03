// Leaving an organization: a transfer-first dialog. These stories cover what the
// unit test cannot reach through static markup: the dialog can be dismissed with
// an explicit Cancel, and a refused leave says so inside the dialog instead of
// failing silently (the mutation reports no toast of its own).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useAction } from '#/components/hooks/use-action'
import { LeaveOrganizationDialog } from './leave-organization-dialog'

const REFUSAL = 'You are still the Responsible Manager for a Property.'

function Harness({ leave }: Readonly<{ leave: () => Promise<unknown> }>) {
  const leaveOrganization = useAction(leave)
  return (
    <LeaveOrganizationDialog
      outstanding={[]}
      candidates={[{ userId: 'user-2', name: 'Dana Manager' }]}
      isSoleAccountAdmin={false}
      selfServiceLeaveAvailable
      leaveOrganization={leaveOrganization}
    />
  )
}

const meta: Meta<typeof Harness> = {
  title: 'People/LeaveOrganizationDialog',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { leave: fn(async () => undefined) },
}
export default meta
type Story = StoryObj<typeof Harness>

async function openDialog(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Leave organization' }),
  )
  const dialog = within(canvasElement.ownerDocument.body)
  const open = await dialog.findByRole('dialog')
  await waitFor(() => expect(open).toBeVisible())
  return dialog
}

/** Cancel closes the dialog without leaving. */
export const Cancel: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog.queryByRole('dialog')).not.toBeInTheDocument())
    expect(args.leave).not.toHaveBeenCalled()
  },
}

/** Cancel sits before the destructive action, so the destructive one is last. */
export const CancelComesBeforeTheAction: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    const footer = dialog.getByRole('button', {
      name: 'Transfer and leave',
    }).parentElement
    const labels = within(footer as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual(['Cancel', 'Transfer and leave'])
  },
}

/** A refused leave is reported in the dialog, above the actions, and the dialog stays open. */
export const RefusalIsShownInTheDialog: Story = {
  args: {
    leave: fn(async () => {
      throw new Error(REFUSAL)
    }),
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Transfer and leave' }))
    expect(args.leave).toHaveBeenCalledTimes(1)
    const banner = await dialog.findByRole('alert')
    expect(banner).toHaveTextContent(REFUSAL)
    expect(dialog.getByRole('dialog')).toBeVisible()
  },
}

export const RefusalIsShownInTheDialogLight: Story = {
  ...RefusalIsShownInTheDialog,
  parameters: { theme: 'light' },
}
