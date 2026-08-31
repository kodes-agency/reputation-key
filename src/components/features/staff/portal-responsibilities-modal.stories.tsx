import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import type { Action } from '#/components/hooks/use-action'
import type { UpdatePortalResponsibilitiesMutationInput } from '#/components/features/staff/types'
import { PortalResponsibilitiesModal } from './portal-responsibilities-modal'

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const updateAction: Action<{
  data: UpdatePortalResponsibilitiesMutationInput
}> = Object.assign(async () => ({ updated: true }), idle)

const portalOptions = [
  { id: 'portal-1', name: 'Main entrance' },
  { id: 'portal-2', name: 'Restaurant' },
  { id: 'portal-3', name: 'Spa' },
]

const meta: Meta<typeof PortalResponsibilitiesModal> = {
  title: 'Staff/PortalResponsibilitiesModal',
  component: PortalResponsibilitiesModal,
  tags: ['autodocs'],
  args: {
    staffParticipationId: 'sp-1',
    displayName: 'Avery Morgan',
    currentPrimaryPortalId: 'portal-1',
    currentSupportingPortalIds: ['portal-2'],
    allPortals: portalOptions,
    updateAction,
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

function QueryRefreshHarness() {
  const [, forceParentRefresh] = useState(0)

  return (
    <>
      <Button onClick={() => forceParentRefresh((revision) => revision + 1)}>
        Simulate query refresh
      </Button>
      <PortalResponsibilitiesModal
        staffParticipationId="sp-1"
        displayName="Avery Morgan"
        currentPrimaryPortalId="portal-1"
        currentSupportingPortalIds={['portal-2']}
        expectedRevision={1}
        allPortals={portalOptions}
        updateAction={updateAction}
        onOpenChange={() => {}}
      />
    </>
  )
}

export const PreservesEditsAcrossQueryRefresh: Story = {
  render: () => <QueryRefreshHarness />,
  play: async ({ canvasElement }) => {
    const page = within(document.body)
    const spa = page.getByRole('checkbox', { name: 'Spa' })

    await userEvent.click(spa)
    await expect(spa).toBeChecked()

    fireEvent.click(
      within(canvasElement).getByRole('button', { name: /refresh/i, hidden: true }),
    )
    await expect(spa).toBeChecked()
  },
}
