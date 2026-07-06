// Edit staff portals modal stories.
// The modal is controlled (open / onOpenChange) and manages its own selection
// state, disabling Save until the selection differs from currentPortalIds.
// Dialog content portals to document.body, so open-state assertions query the
// document rather than the story canvas.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { PortalOption } from './portal-selector'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import { EditStaffPortalsModal } from './edit-staff-portals-modal'

type UpdateInput = {
  data: { userId: string; propertyId: string; portalIds: string[] }
}

function makeAction(
  impl: (input: UpdateInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<UpdateInput, unknown> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const allPortals: ReadonlyArray<PortalOption> = [
  { id: 'p1', name: 'Reviews Portal' },
  { id: 'p2', name: 'Feedback Portal' },
]

const meta: Meta<typeof EditStaffPortalsModal> = {
  title: 'Staff/EditStaffPortalsModal',
  component: EditStaffPortalsModal,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof EditStaffPortalsModal>

const baseArgs = {
  userId: 'u1',
  userName: 'Alice Tan',
  propertyId: 'prop-1',
  currentPortalIds: ['p1'],
  allPortals,
  onOpenChange: fn(),
}

const resolvingAction = makeAction(async () => ({ ok: true }))

// Closed: the controlled dialog renders nothing.
export const Closed: Story = {
  args: { ...baseArgs, open: false, updateAction: resolvingAction },
}

// Open with the current selection unchanged → Save is disabled (no changes).
export const Open: Story = {
  args: { ...baseArgs, open: true, updateAction: resolvingAction },
  play: async () => {
    const save = await within(document.body).findByRole('button', { name: /^save$/i })
    expect(save).toBeDisabled()
  },
}

// Save in flight: button relabels to "Saving..." and is disabled.
export const Pending: Story = {
  args: {
    ...baseArgs,
    open: true,
    updateAction: makeAction(() => new Promise<unknown>(() => {}), {
      isPending: true,
    }),
  },
  play: async () => {
    const save = await within(document.body).findByRole('button', { name: /saving/i })
    expect(save).toBeDisabled()
  },
}

// Server rejected the update — inline destructive message surfaces.
export const ErrorState: Story = {
  args: {
    ...baseArgs,
    open: true,
    updateAction: makeAction(
      async () => {
        throw new Error('Portal assignment failed')
      },
      { error: new Error('Portal assignment failed') },
    ),
  },
  play: async () => {
    expect(
      await within(document.body).findByText(/portal assignment failed/i),
    ).toBeInTheDocument()
  },
}

// Toggle a portal on → Save enables → clicking it submits the new selection
// and requests the modal close.
const saveSpy = fn()
const saveAction = makeAction(async (input) => {
  saveSpy(input)
  return { ok: true }
})
const openChangeSpy = fn()
export const SaveChanges: Story = {
  args: {
    ...baseArgs,
    open: true,
    updateAction: saveAction,
    onOpenChange: openChangeSpy,
  },
  play: async () => {
    saveSpy.mockClear()
    openChangeSpy.mockClear()
    // Add the second portal → selection now differs from current ['p1'].
    await userEvent.click(
      await within(document.body).findByRole('checkbox', { name: /feedback portal/i }),
    )
    const save = within(document.body).getByRole('button', { name: /^save$/i })
    expect(save).not.toBeDisabled()
    await userEvent.click(save)
    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1)
    })
    expect(saveSpy).toHaveBeenCalledWith({
      data: { userId: 'u1', propertyId: 'prop-1', portalIds: ['p1', 'p2'] },
    })
    expect(openChangeSpy).toHaveBeenCalledWith(false)
  },
}
