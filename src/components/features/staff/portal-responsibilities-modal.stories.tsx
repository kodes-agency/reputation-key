import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { Action } from '#/components/hooks/use-action'
import { useRefusingAction } from '#/components/forms/refusing-action.stories.fixtures'
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

/** The mutation still holds a refusal from the last time the modal was open. */
function RefusingModal() {
  const refusing = useRefusingAction<{ data: UpdatePortalResponsibilitiesMutationInput }>(
    () =>
      new ServerFunctionError(
        'StaffError',
        'Responsibilities could not be saved.',
        'conflict',
        409,
      ),
    new Error('an earlier refusal'),
  )
  return (
    <PortalResponsibilitiesModal
      staffParticipationId="sp-1"
      displayName="Avery Morgan"
      currentPrimaryPortalId="portal-1"
      currentSupportingPortalIds={[]}
      expectedRevision={3}
      allPortals={portalOptions}
      updateAction={refusing}
      onOpenChange={() => {}}
    />
  )
}

export const MutationError: Story = {
  render: () => <RefusingModal />,
  play: async () => {
    const page = within(document.body)
    expect(page.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('combobox', { name: 'Primary portal' }))
    await userEvent.click(await page.findByRole('option', { name: 'Restaurant' }))
    await userEvent.click(page.getByRole('button', { name: 'Save responsibilities' }))
    await expect(
      await page.findByText('Responsibilities could not be saved.'),
    ).toBeInTheDocument()
    expect(page.queryByText(/earlier refusal/)).not.toBeInTheDocument()
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
