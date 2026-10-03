// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// The group dialogs (board 12): New group, Add portals and Rename. The property
// is Avela Resort before "Pool side" exists: Wellness and Front of house hold
// portals, three are in no group.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { action } from '../portal-list-page-stories-data'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { overviewGroup, overviewRow } from '../portal-overview/portal-overview-fixtures'
import {
  PortalGroupAddPortalsDialog,
  PortalGroupDialog,
  PortalGroupRenameDialog,
} from './portal-group-dialogs'

const wellness = overviewGroup('group-wellness', 'Wellness')
const front = overviewGroup('group-front', 'Front of house')

const rows = [
  overviewRow('p-terrace', { name: 'Pool & Terrace' }),
  overviewRow('p-bar', { name: 'Pool bar', publicationState: 'draft' }),
  overviewRow('p-olive', { name: 'Olive Terrace restaurant' }),
  overviewRow('p-spa', { name: 'Spa & thermal pools', group: wellness }),
  overviewRow('p-reception', { name: 'Reception', group: front }),
  overviewRow('p-rooms', { name: 'Guest rooms', group: front }),
]

const createMutation = action<{
  data: { propertyId: string; name: string; portalIds?: string[] }
}>()

const meta: Meta<typeof PortalGroupDialog> = {
  title: 'Portal/PortalGroup/Dialogs',
  component: PortalGroupDialog,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    open: true,
    onOpenChange: fn(),
    propertyId: 'prop-1',
    rows,
    createMutation,
  },
}
export default meta
type Story = StoryObj<typeof PortalGroupDialog>

const dialog = () => within(screen.getByRole('dialog'))

export const NewGroup: Story = {
  play: async () => {
    const d = dialog()
    await expect(d.getByRole('heading', { name: 'New group' })).toBeInTheDocument()
    await expect(d.getByText(/guests never see groups/i)).toBeInTheDocument()
    await expect(d.getByRole('button', { name: 'Create group' })).toBeDisabled()
  },
}

// Board 12: portals are grouped by where each is now.
export const ChecklistIsGroupedByWhereEachPortalIsNow: Story = {
  play: async () => {
    const d = dialog()
    const sections = d
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    await expect(sections).toEqual(['Not in a group', 'In Front of house', 'In Wellness'])
    await expect(d.getByText('Draft')).toBeInTheDocument()
    await expect(d.getByText('No portals selected')).toBeInTheDocument()
  },
}

// Choosing a portal that is in another group moves it, and says its results stay.
export const ChoosingAPortalInAnotherGroupSaysItMoves: Story = {
  play: async () => {
    const d = dialog()
    await userEvent.type(d.getByLabelText('Name'), 'Pool side')
    await userEvent.click(d.getByRole('checkbox', { name: /pool & terrace/i }))
    await userEvent.click(d.getByRole('checkbox', { name: /pool bar/i }))
    await userEvent.click(d.getByRole('checkbox', { name: /spa & thermal pools/i }))
    await expect(
      d.getByText('Moves from Wellness. Its results so far stay with Wellness.'),
    ).toBeInTheDocument()
    await expect(d.getByText('3 portals selected')).toBeInTheDocument()
    await expect(d.getByRole('button', { name: 'Create group' })).toBeEnabled()
  },
}

export const CreatesTheGroupWithTheChosenPortals: Story = {
  args: {
    createMutation: Object.assign(
      fn(async () => undefined),
      {
        isPending: false,
        error: null,
        isSuccess: false,
        data: null,
      },
    ),
  },
  play: async ({ args }) => {
    const d = dialog()
    await userEvent.type(d.getByLabelText('Name'), 'Pool side')
    await userEvent.click(d.getByRole('checkbox', { name: /pool & terrace/i }))
    await userEvent.click(d.getByRole('checkbox', { name: /spa & thermal pools/i }))
    await userEvent.click(d.getByRole('button', { name: 'Create group' }))
    await waitFor(() =>
      expect(args.createMutation).toHaveBeenCalledWith({
        data: {
          propertyId: 'prop-1',
          name: 'Pool side',
          portalIds: ['p-terrace', 'p-spa'],
        },
      }),
    )
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

const refused = new ServerFunctionError(
  'PortalGroupError',
  'a group with this name already exists',
  'group_name_taken',
  409,
)

export const ARefusalIsShownInPlace: Story = {
  args: {
    createMutation: Object.assign(
      fn(async () => {
        throw refused
      }),
      {
        isPending: false,
        error: refused,
        isSuccess: false,
        data: null,
      },
    ),
  },
  play: async () => {
    const d = dialog()
    // Nothing from an earlier attempt shows before this one is made.
    await expect(d.queryByText(/already exists/i)).toBeNull()
    await userEvent.type(d.getByLabelText('Name'), 'Pool side')
    await userEvent.click(d.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(d.getByText(/already exists/i)).toBeInTheDocument())
  },
}

export const NoPortalsLeftToAdd: StoryObj<typeof PortalGroupAddPortalsDialog> = {
  render: () => (
    <PortalGroupAddPortalsDialog
      open
      onOpenChange={() => undefined}
      group={{ id: 'group-front', name: 'Front of house' }}
      rows={rows.filter((row) => row.group?.id === 'group-front')}
      movePortalMutation={action<{ data: { portalGroupId: string; portalId: string } }>()}
    />
  ),
  play: async () => {
    await expect(dialog().getByText('No other portals to add')).toBeInTheDocument()
    await expect(dialog().getByRole('button', { name: 'Add to group' })).toBeDisabled()
  },
}

const moveMock = Object.assign(
  fn(async (_input: { data: { portalGroupId: string; portalId: string } }) => undefined),
  { isPending: false, error: null, isSuccess: false, data: null },
)

export const AddPortalsMovesEachOneIn: StoryObj<typeof PortalGroupAddPortalsDialog> = {
  render: () => (
    <PortalGroupAddPortalsDialog
      open
      onOpenChange={() => undefined}
      group={{ id: 'group-front', name: 'Front of house' }}
      rows={rows}
      movePortalMutation={moveMock}
    />
  ),
  play: async () => {
    moveMock.mockClear()
    const d = dialog()
    // The group's own portals are not offered again.
    await expect(d.queryByRole('checkbox', { name: /reception/i })).toBeNull()
    await userEvent.click(d.getByRole('checkbox', { name: /olive terrace/i }))
    await userEvent.click(d.getByRole('checkbox', { name: /spa & thermal pools/i }))
    await userEvent.click(d.getByRole('button', { name: 'Add to group' }))
    await waitFor(() => expect(moveMock).toHaveBeenCalledTimes(2))
    await expect(moveMock).toHaveBeenNthCalledWith(1, {
      data: { portalGroupId: 'group-front', portalId: 'p-olive' },
    })
    await expect(moveMock).toHaveBeenNthCalledWith(2, {
      data: { portalGroupId: 'group-front', portalId: 'p-spa' },
    })
  },
}

const failingSecondMove = Object.assign(
  fn(async (_input: { data: { portalGroupId: string; portalId: string } }) => undefined),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
)

// One portal moved and the next was refused: only the rest stays ticked, so
// trying again does not move a portal that is already in the group.
export const ARefusalPartWayLeavesOnlyTheRestTicked: StoryObj<
  typeof PortalGroupAddPortalsDialog
> = {
  render: () => (
    <PortalGroupAddPortalsDialog
      open
      onOpenChange={() => undefined}
      group={{ id: 'group-front', name: 'Front of house' }}
      rows={rows}
      movePortalMutation={failingSecondMove}
    />
  ),
  play: async () => {
    failingSecondMove.mockReset()
    failingSecondMove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('portal is already in this group'))
    const d = dialog()
    await userEvent.click(d.getByRole('checkbox', { name: /olive terrace/i }))
    await userEvent.click(d.getByRole('checkbox', { name: /spa & thermal pools/i }))
    await userEvent.click(d.getByRole('button', { name: 'Add to group' }))
    await waitFor(() => expect(failingSecondMove).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(d.getByText('1 portal selected')).toBeInTheDocument())
    await expect(d.getByRole('checkbox', { name: /olive terrace/i })).not.toBeChecked()
    await expect(d.getByRole('checkbox', { name: /spa & thermal pools/i })).toBeChecked()
  },
}

export const RenameKeepsTheCurrentNameToEdit: StoryObj<typeof PortalGroupRenameDialog> = {
  render: () => (
    <PortalGroupRenameDialog
      open
      onOpenChange={() => undefined}
      group={{ id: 'group-pool', name: 'Pools' }}
      renameMutation={action<{ data: { portalGroupId: string; name: string } }>()}
    />
  ),
  play: async () => {
    const d = dialog()
    await expect(d.getByLabelText('Name')).toHaveValue('Pools')
    await userEvent.clear(d.getByLabelText('Name'))
    await expect(d.getByRole('button', { name: 'Save name' })).toBeDisabled()
  },
}
