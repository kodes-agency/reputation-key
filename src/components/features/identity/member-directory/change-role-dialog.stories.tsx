// Change role dialog stories. The dialog is controlled by the Members route and
// portals to document.body, so assertions query the document. A refused change
// rejects the route's Action; the dialog settles it and stays open for a retry.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { ChangeRoleDialog } from './change-role-dialog'

type UpdateInput = { data: { memberId: string; role: BetaInteractiveRole } }
type UpdateAction = Action<UpdateInput>

const allowedRoles: ReadonlyArray<BetaInteractiveRole> = [
  'PropertyManager',
  'AccountAdmin',
]
const manager = {
  id: 'member-2',
  name: 'Maria Petrova',
  role: 'PropertyManager' as const,
}
const admin = { id: 'member-3', name: 'Petar Kolev', role: 'AccountAdmin' as const }

const action = (
  impl: (input: UpdateInput) => Promise<unknown>,
  isPending = false,
): UpdateAction =>
  Object.assign(impl, {
    isPending,
    error: null,
    isSuccess: false,
    data: null,
  }) as UpdateAction

const meta: Meta<typeof ChangeRoleDialog> = {
  title: 'Identity/MemberDirectory/ChangeRoleDialog',
  component: ChangeRoleDialog,
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
  args: { allowedRoles, onClose: fn() },
}
export default meta
type Story = StoryObj<typeof ChangeRoleDialog>

const dialog = () => within(document.body).findByRole('alertdialog')

/** Open on a manager: nothing to confirm until another role is chosen. */
export const Open: Story = {
  args: { member: manager, updateRoleAction: action(async () => undefined) },
  play: async () => {
    const body = within(await dialog())
    expect(body.getByRole('radio', { name: /property manager/i })).toBeChecked()
    expect(body.getByText('Maria Petrova already has this role.')).toBeInTheDocument()
    expect(body.getByRole('button', { name: 'Change role' })).toBeDisabled()
  },
}

export const OpenLight: Story = {
  ...Open,
  parameters: { theme: 'light' },
}

const promoteSpy = fn()
/** Promoting explains what an Account Admin can do, then confirms. */
export const Promote: Story = {
  args: {
    member: manager,
    updateRoleAction: action(async (input) => {
      promoteSpy(input)
    }),
  },
  play: async () => {
    promoteSpy.mockClear()
    const body = within(await dialog())
    await userEvent.click(body.getByRole('radio', { name: /account admin/i }))
    expect(
      body.getByText(/will see every property and manage members/i),
    ).toBeInTheDocument()
    await userEvent.click(body.getByRole('button', { name: 'Change role' }))
    await waitFor(() =>
      expect(promoteSpy).toHaveBeenCalledWith({
        data: { memberId: 'member-2', role: 'AccountAdmin' },
      }),
    )
  },
}

/** Demoting warns that only granted properties stay, and the last-admin refusal. */
export const Demote: Story = {
  args: { member: admin, updateRoleAction: action(async () => undefined) },
  play: async () => {
    const body = within(await dialog())
    await userEvent.click(body.getByRole('radio', { name: /property manager/i }))
    expect(body.getByText(/only the properties you grant them/i)).toBeInTheDocument()
    expect(body.getByText(/last Account Admin/i)).toBeInTheDocument()
    expect(body.getByRole('button', { name: 'Change role' })).toBeEnabled()
  },
}

export const Changing: Story = {
  args: {
    member: manager,
    updateRoleAction: action(() => new Promise<unknown>(() => {}), true),
  },
  play: async () => {
    const body = within(await dialog())
    expect(body.getByRole('button', { name: 'Changing…' })).toBeDisabled()
  },
}

/**
 * The route's role change outlives the dialog's body, and its success closes
 * "the" dialog, which by then could be another member's. So the dialog cannot
 * be left while the change is in flight, by Cancel or by Escape.
 */
export const CannotBeLeftWhileChanging: Story = {
  args: {
    member: manager,
    onClose: fn(),
    updateRoleAction: action(() => new Promise<unknown>(() => {}), true),
  },
  play: async ({ args }) => {
    const body = within(await dialog())
    expect(body.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(args.onClose).not.toHaveBeenCalled()
    expect(await dialog()).toBeInTheDocument()
  },
}

/**
 * A refused change rejects the route's Action (which toasts it). The dialog
 * settles the promise, so nothing is unhandled, and stays open for a retry.
 */
const refusals: Error[] = []
export const Refused: Story = {
  args: {
    member: admin,
    updateRoleAction: action(async () => {
      const refusal = new Error('The organization needs at least one Account Admin.')
      refusals.push(refusal)
      throw refusal
    }),
  },
  play: async () => {
    refusals.length = 0
    const unhandled: unknown[] = []
    const record = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', record)
    try {
      const body = within(await dialog())
      await userEvent.click(body.getByRole('radio', { name: /property manager/i }))
      await userEvent.click(body.getByRole('button', { name: 'Change role' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      window.removeEventListener('unhandledrejection', record)
    }
    expect(refusals).toHaveLength(1)
    expect(unhandled).toEqual([])
    expect(await dialog()).toBeInTheDocument()
  },
}
