// Inbox reopen dialog — reason picker over a confirm callback the caller
// owns. The refusal story is the contract that matters: a command the
// server refuses (a withdrawn source, a stale revision) stays inside the
// dialog with its reason shown, instead of closing it or leaking the
// rejection.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { InboxReopenDialog } from './inbox-reopen-dialog'

const REFUSAL =
  'Withdrawn, purged or unavailable private feedback cannot be reopened: no manager outcome could ever close it'

const meta: Meta<typeof InboxReopenDialog> = {
  title: 'Inbox/Reopen Dialog',
  component: InboxReopenDialog,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    open: true,
    pending: false,
    onOpenChange: fn(),
  },
}
export default meta

type Story = StoryObj<typeof meta>

const pickReason = async (body: ReturnType<typeof within>) => {
  await userEvent.click(body.getByRole('combobox', { name: 'Reason for reopening' }))
  await userEvent.click(await body.findByRole('option', { name: 'New information' }))
}

export const Confirms: Story = {
  args: { onConfirm: fn(async () => undefined) },
  play: async ({ args }) => {
    const body = within(document.body)
    await pickReason(body)
    await userEvent.click(body.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

export const Refused: Story = {
  args: {
    onConfirm: fn(async () => {
      throw new Error(REFUSAL)
    }),
  },
  play: async ({ args }) => {
    const body = within(document.body)
    await pickReason(body)
    await userEvent.click(body.getByRole('button', { name: 'Reopen' }))
    await expect(await body.findByText(REFUSAL)).toBeInTheDocument()
    await expect(body.getByRole('dialog', { name: 'Reopen work' })).toBeInTheDocument()
    await expect(args.onOpenChange).not.toHaveBeenCalledWith(false)
  },
}
