// Change role dialog stories. The dialog is controlled by the Members route and
// portals to document.body, so assertions query the document. A refused change
// rejects the route's Action; the dialog says it in place and stays open for a retry.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { mockAction } from '../../../../../.storybook/mocks/mock-action'
import {
  expectHeldOpen,
  unhandledRejectionsDuring,
} from '../../../../../.storybook/play-helpers'
import { ChangeRoleDialog } from './change-role-dialog'

type UpdateInput = { data: { memberId: string; role: BetaInteractiveRole } }
const action = (impl: (input: UpdateInput) => Promise<unknown>) =>
  mockAction<UpdateInput>(impl)

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

/** Confirms a promotion that has not settled yet, the way a slow server leaves it. */
async function confirmPromotion() {
  const body = within(await dialog())
  await userEvent.click(body.getByRole('radio', { name: /account admin/i }))
  await userEvent.click(body.getByRole('button', { name: 'Change role' }))
  return body
}

export const Changing: Story = {
  args: {
    member: manager,
    updateRoleAction: action(() => new Promise<unknown>(() => {})),
  },
  play: async () => {
    const body = await confirmPromotion()
    expect(await body.findByRole('button', { name: /changing/i })).toBeDisabled()
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
    updateRoleAction: action(() => new Promise<unknown>(() => {})),
  },
  play: async ({ args }) => {
    await confirmPromotion()
    await expectHeldOpen(dialog, args.onClose)
  },
}

/**
 * A refused change rejects the route's Action. The dialog settles the promise,
 * so nothing is unhandled, and stays open with the refusal said once, for a retry.
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
    const unhandled = await unhandledRejectionsDuring(async () => {
      const body = within(await dialog())
      await userEvent.click(body.getByRole('radio', { name: /property manager/i }))
      await userEvent.click(body.getByRole('button', { name: 'Change role' }))
    })
    expect(refusals).toHaveLength(1)
    expect(unhandled).toEqual([])
    const body = within(await dialog())
    // A plain Error is not a server refusal, so the banner says the generic sentence.
    expect(await body.findByText('Unable to complete this action')).toBeInTheDocument()
  },
}
