import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { UpdatePortalResponsibilitiesMutationInput } from '#/components/features/team/shared/types'
import { PortalResponsibilitiesModal } from './portal-responsibilities-modal'

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const updateAction: Action<{
  data: UpdatePortalResponsibilitiesMutationInput
}> = Object.assign(async () => ({ updated: true }), idle)

const meta: Meta<typeof PortalResponsibilitiesModal> = {
  title: 'Staff/PortalResponsibilitiesModal',
  component: PortalResponsibilitiesModal,
  tags: ['autodocs'],
  args: {
    staffParticipationId: 'sp-1',
    displayName: 'Avery Morgan',
    currentPrimaryPortalId: 'portal-1',
    currentSupportingPortalIds: ['portal-2'],
    allPortals: [
      { id: 'portal-1', name: 'Main entrance' },
      { id: 'portal-2', name: 'Restaurant' },
      { id: 'portal-3', name: 'Spa' },
    ],
    updateAction,
    open: true,
    onOpenChange: () => {},
  },
}
export default meta
type Story = StoryObj<typeof PortalResponsibilitiesModal>

export const Populated: Story = {
  play: async () => {
    await expect(
      within(document.body).getByText(/responsibilities do not grant property access/i),
    ).toBeInTheDocument()
  },
}

export const NoPortals: Story = {
  args: {
    currentPrimaryPortalId: null,
    currentSupportingPortalIds: [],
    allPortals: [],
  },
}

export const MutationError: Story = {
  args: {
    updateAction: Object.assign(async () => ({ updated: false }), {
      ...idle,
      error: new Error('Responsibilities could not be saved.'),
    }),
  },
  play: async () => {
    await expect(
      within(document.body).getByText('Responsibilities could not be saved.'),
    ).toBeInTheDocument()
  },
}
