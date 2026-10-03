// Disabling an approved link destination cannot be undone (only a pending
// destination can be approved), so the Disable button asks first. Approving
// stays one click: it is the safe direction.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
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

async function openDisable(canvasElement: HTMLElement) {
  const [first] = within(canvasElement).getAllByRole('button', { name: 'Disable' })
  await userEvent.click(first!)
  const dialog = within(canvasElement.ownerDocument.body)
  const alert = await dialog.findByRole('alertdialog')
  await waitFor(() => expect(alert).toBeVisible())
  return dialog
}

/** Disable asks first, names the site, and runs only on confirm. */
export const DisableAsksFirst: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDisable(canvasElement)
    expect(args.actions.disableDestination).not.toHaveBeenCalled()
    expect(
      dialog.getByRole('heading', { name: 'Disable www.tripadvisor.com?' }),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Disable destination' }))
    await waitFor(() =>
      expect(args.actions.disableDestination).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          destinationId: 'destination-1',
          reason: 'Disabled by an Account Admin',
        },
      }),
    )
  },
}

export const DisableAsksFirstLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement, args }) => {
    await openDisable(canvasElement)
    expect(args.actions.disableDestination).not.toHaveBeenCalled()
  },
}

export const KeepDestination: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDisable(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep destination' }))
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
