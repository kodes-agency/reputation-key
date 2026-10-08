// Sites allowed for links: the account admin's overview of every site a tile may
// open, behind a disclosure that opens by itself while a site waits for an
// answer. Turning off a site cannot be undone (only a waiting site can be
// approved), so it asks first. Approving stays one click: it is the safe
// direction. A manager has no list here: addresses are entered on the tiles.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { openAlertDialog } from '#/components/ui/confirmation-dialog.stories.open'
import { PortalApprovedDestinationsEditor } from './portal-approved-destinations-editor'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
} from './portal-experience-settings-types'

function idleAction<TInput>(): Action<TInput> {
  return Object.assign(
    fn(async (_input: TInput) => undefined),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as Action<TInput>
}

const actions = (): PortalExperienceActions => ({
  saveContent: idleAction(),
  saveOverride: idleAction(),
  requestDestination: idleAction(),
  approveDestination: idleAction(),
  disableDestination: idleAction(),
})

const destinations: PortalApprovedDestinationList = {
  canApprove: true,
  destinations: [
    {
      id: 'destination-1',
      normalizedUri: 'https://www.tripadvisor.com/Hotel_Review-g1',
      hostname: 'www.tripadvisor.com',
      sourceType: 'recognized',
      approvalState: 'approved',
      lastValidatedAt: '2026-09-01T09:00:00.000Z',
    },
    {
      id: 'destination-2',
      normalizedUri: 'https://example.com/reviews',
      hostname: 'example.com',
      sourceType: 'custom',
      approvalState: 'pending',
      lastValidatedAt: '2026-09-02T09:00:00.000Z',
    },
  ],
}

const meta: Meta<typeof PortalApprovedDestinationsEditor> = {
  title: 'Portal/PortalApprovedDestinationsEditor',
  component: PortalApprovedDestinationsEditor,
  parameters: { layout: 'padded' },
  args: {
    portalId: 'portal-1',
    state: destinations,
    actions: actions(),
    disabled: false,
  },
}
export default meta
type Story = StoryObj<typeof PortalApprovedDestinationsEditor>

const openTurnOff = (canvasElement: HTMLElement) =>
  openAlertDialog(canvasElement, 'Turn off')

/** A site waits for an answer, so the list is open and says so on its heading. */
export const OpensWhileASiteWaits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /Sites allowed for links/ }),
    ).toHaveTextContent('1 waiting for approval')
    await expect(canvas.getByText('www.tripadvisor.com')).toBeVisible()
    // One name per state, the tile's own words.
    await expect(canvas.getByText('Approved')).toBeVisible()
    await expect(canvas.getByText('Waiting for approval')).toBeVisible()
    // The address field has a visible label, not just a hidden one.
    await expect(canvas.getByLabelText('Site address')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add site' })).toBeVisible()
  },
}

/** Nothing waits, so the list stays folded until an admin wants it. */
export const FoldedWhenNothingWaits: Story = {
  args: {
    state: {
      canApprove: true,
      destinations: [destinations.destinations[0]!],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Sites allowed for links/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveTextContent('1 site')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('www.tripadvisor.com')).toBeVisible()
  },
}

export const EmptyListSaysNoOtherSitesYet: Story = {
  args: { state: { canApprove: true, destinations: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Sites allowed for links/ }))
    await expect(canvas.getByText('No other sites added yet.')).toBeVisible()
    await expect(canvas.queryByText(/secondary/i)).toBeNull()
  },
}

/** A manager enters addresses on the tiles: there is no second place to add one. */
export const ManagerHasNoList: Story = {
  args: { state: { ...destinations, canApprove: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('button', { name: /Sites allowed for links/ }),
    ).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Add site' })).toBeNull()
  },
}

/** Turning off asks first, names the site, and runs only on confirm. */
export const TurnOffAsksFirst: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openTurnOff(canvasElement)
    expect(args.actions.disableDestination).not.toHaveBeenCalled()
    expect(
      dialog.getByRole('heading', { name: 'Turn off www.tripadvisor.com?' }),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Turn off site' }))
    await waitFor(() =>
      expect(args.actions.disableDestination).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          destinationId: 'destination-1',
          reason: 'Turned off by an account admin',
        },
      }),
    )
  },
}

export const TurnOffAsksFirstLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement, args }) => {
    await openTurnOff(canvasElement)
    expect(args.actions.disableDestination).not.toHaveBeenCalled()
  },
}

export const KeepItOn: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openTurnOff(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep it on' }))
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.actions.disableDestination).not.toHaveBeenCalled()
  },
}

/** Approving is the safe direction: one click, no question. */
export const ApproveActsAtOnce: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(args.actions.approveDestination).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', destinationId: 'destination-2' },
      }),
    )
  },
}

/** A held back site has no action, so the row says why and where to turn. */
export const HeldBackSiteIsExplained: Story = {
  args: {
    state: {
      canApprove: true,
      destinations: [
        {
          id: 'destination-3',
          normalizedUri: 'https://shady.example/menu',
          hostname: 'shady.example',
          sourceType: 'custom',
          approvalState: 'quarantined',
          lastValidatedAt: '2026-09-03T09:00:00.000Z',
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Sites allowed for links/ }))
    await expect(canvas.getByText('Held back for safety')).toBeVisible()
    await expect(canvas.queryByText('Quarantined')).toBeNull()
    await expect(canvas.getByText(/Held back by our safety checks/)).toBeVisible()
    await expect(canvas.getByText(/Contact support if this is your site/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Approve' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Turn off' })).toBeNull()
  },
}
