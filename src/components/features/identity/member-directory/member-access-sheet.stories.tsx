// Manage access sheet stories. The sheet is controlled by the Members route and
// portals to document.body, so assertions query the document. The route owns
// loading the member's grants and responsibility, so each state is a prop.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { MemberAccessSheet, type SaveMemberAccessInput } from './member-access-sheet'

const PROPERTIES = [
  { id: 'p1', name: 'Meridian Sofia' },
  { id: 'p2', name: 'Varna Beach' },
  { id: 'p3', name: 'Harbour Cafe Burgas' },
  { id: 'p4', name: 'Meridian Plovdiv Old Town' },
  { id: 'p5', name: 'Rila Lodge' },
  { id: 'p6', name: 'Sea Garden Bar' },
]
const MARIA = {
  id: 'member-2',
  userId: 'user-2',
  name: 'Maria Petrova',
  email: 'maria@example.com',
  role: 'PropertyManager' as const,
}

const saveAction = (
  impl: (input: SaveMemberAccessInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown } = {},
): Action<SaveMemberAccessInput> =>
  Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: false,
    data: null,
  }) as Action<SaveMemberAccessInput>

const removeAction = Object.assign(async () => undefined, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as Action<{ data: { memberId: string } }>

const meta: Meta<typeof MemberAccessSheet> = {
  title: 'Identity/MemberDirectory/MemberAccessSheet',
  component: MemberAccessSheet,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    member: MARIA,
    onClose: fn(),
    properties: PROPERTIES,
    currentPropertyIds: ['p1', 'p2'],
    responsibility: { status: 'ready', responsibleIds: ['p1'] },
    canRemove: true,
    saveAction: saveAction(async () => undefined),
    removeMemberAction: removeAction,
  },
}
export default meta
type Story = StoryObj<typeof MemberAccessSheet>

const sheet = () => within(document.body).findByRole('dialog')

/** Maria works two of six properties and is responsible for one. */
export const Default: Story = {
  play: async () => {
    const body = within(await sheet())
    expect(body.getByText('Properties · 2 of 6')).toBeInTheDocument()
    expect(body.getByRole('checkbox', { name: 'Meridian Sofia' })).toBeChecked()
    expect(body.getByRole('checkbox', { name: 'Harbour Cafe Burgas' })).not.toBeChecked()
    expect(
      body.getByRole('switch', { name: 'Responsible for Meridian Sofia' }),
    ).toBeChecked()
    expect(body.getByText('No changes yet.')).toBeInTheDocument()
    expect(body.getByRole('button', { name: 'Save access' })).toBeDisabled()
  },
}

export const DefaultLight: Story = {
  ...Default,
  parameters: { theme: 'light' },
}

const saveSpy = fn()
/** Grant one, revoke one, change responsibility: the summary says it, Save sends it. */
export const EditAndSave: Story = {
  args: {
    saveAction: saveAction(async (input) => {
      saveSpy(input)
    }),
  },
  play: async () => {
    saveSpy.mockClear()
    const body = within(await sheet())
    await userEvent.click(body.getByRole('checkbox', { name: 'Harbour Cafe Burgas' }))
    await userEvent.click(body.getByRole('checkbox', { name: 'Varna Beach' }))
    await userEvent.click(
      body.getByRole('switch', { name: 'Responsible for Meridian Sofia' }),
    )
    await userEvent.click(
      body.getByRole('switch', { name: 'Responsible for Harbour Cafe Burgas' }),
    )

    expect(
      body.getByText('Gives Maria access to Harbour Cafe Burgas.'),
    ).toBeInTheDocument()
    expect(
      body.getByText(/Removes access to Varna Beach\. Maria loses its Inbox/),
    ).toBeInTheDocument()
    expect(
      body.getByText(/Makes Maria responsible for Harbour Cafe Burgas/),
    ).toBeInTheDocument()
    expect(
      body.getByText('Maria stops being responsible for Meridian Sofia.'),
    ).toBeInTheDocument()
    expect(body.getByText('We tell Maria in the app and by email.')).toBeInTheDocument()

    await userEvent.click(body.getByRole('button', { name: 'Save access' }))
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith({
        memberId: 'member-2',
        userId: 'user-2',
        grantPropertyIds: ['p3'],
        revokePropertyIds: ['p2'],
        responsibleOnPropertyIds: ['p3'],
        responsibleOffPropertyIds: ['p1'],
      }),
    )
  },
}

/** A manager with no properties: select all, then save grants every one. */
const selectAllSpy = fn()
export const SelectAllForAStrandedManager: Story = {
  args: {
    currentPropertyIds: [],
    responsibility: { status: 'ready', responsibleIds: [] },
    saveAction: saveAction(async (input) => {
      selectAllSpy(input)
    }),
  },
  play: async () => {
    selectAllSpy.mockClear()
    const body = within(await sheet())
    expect(body.getByText('Properties · 0 of 6')).toBeInTheDocument()
    await userEvent.click(body.getByRole('checkbox', { name: 'Select all' }))
    expect(body.getByText('Properties · 6 of 6')).toBeInTheDocument()
    await userEvent.click(body.getByRole('button', { name: 'Save access' }))
    await waitFor(() =>
      expect(selectAllSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          grantPropertyIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
          revokePropertyIds: [],
        }),
      ),
    )
  },
}

/** Search narrows the list, and Select all then acts on the matches only. */
export const SearchNarrowsSelectAll: Story = {
  args: {
    currentPropertyIds: [],
    responsibility: { status: 'ready', responsibleIds: [] },
  },
  play: async () => {
    const body = within(await sheet())
    await userEvent.type(
      body.getByRole('searchbox', { name: 'Search properties' }),
      'meridian',
    )
    expect(body.queryByRole('checkbox', { name: 'Varna Beach' })).toBeNull()
    await userEvent.click(body.getByRole('checkbox', { name: 'Select all matching' }))
    expect(body.getByText('Properties · 2 of 6')).toBeInTheDocument()
    await userEvent.clear(body.getByRole('searchbox', { name: 'Search properties' }))
    expect(
      body.getByRole('checkbox', { name: 'Meridian Plovdiv Old Town' }),
    ).toBeChecked()
    expect(body.getByRole('checkbox', { name: 'Varna Beach' })).not.toBeChecked()
  },
}

export const NothingMatchesTheSearch: Story = {
  play: async () => {
    const body = within(await sheet())
    await userEvent.type(
      body.getByRole('searchbox', { name: 'Search properties' }),
      'zzz',
    )
    expect(body.getByText(/No property matches/)).toBeInTheDocument()
  },
}

export const NoPropertiesInTheOrganization: Story = {
  args: { properties: [], currentPropertyIds: [] },
  play: async () => {
    const body = within(await sheet())
    expect(body.getByText(/No properties yet/)).toBeInTheDocument()
  },
}

export const LoadingResponsibility: Story = {
  args: { responsibility: { status: 'loading' } },
  play: async () => {
    const body = within(await sheet())
    expect(body.getByText('Loading access…')).toBeInTheDocument()
    expect(body.queryByRole('button', { name: 'Save access' })).toBeNull()
  },
}

/** Responsibility could not be read: access is still editable, the switches are not drawn. */
export const ResponsibilityUnavailable: Story = {
  args: { responsibility: { status: 'unavailable' } },
  play: async () => {
    const body = within(await sheet())
    expect(body.getByText(/Responsible managers could not be loaded/)).toBeInTheDocument()
    expect(body.queryByRole('switch')).toBeNull()
    expect(body.getByRole('checkbox', { name: 'Meridian Sofia' })).toBeEnabled()
  },
}

export const Saving: Story = {
  args: {
    saveAction: saveAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
  play: async () => {
    const body = within(await sheet())
    expect(body.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(body.getByRole('checkbox', { name: 'Meridian Sofia' })).toBeDisabled()
  },
}

export const SaveRefused: Story = {
  args: {
    saveAction: saveAction(async () => undefined, {
      error: new Error('You cannot change your own property access.'),
    }),
  },
  play: async () => {
    const body = within(await sheet())
    expect(body.getByText(/cannot change your own property access/i)).toBeInTheDocument()
  },
}

export const ReadOnlyRemoval: Story = {
  args: { canRemove: false },
  play: async () => {
    const body = within(await sheet())
    expect(body.queryByRole('button', { name: 'Remove' })).toBeNull()
  },
}

/** Removing a member from the sheet confirms first, then closes the sheet. */
const removeSpy = fn()
export const RemoveFromTheSheet: Story = {
  args: {
    onClose: fn(),
    removeMemberAction: Object.assign(
      async (input: { data: { memberId: string } }) => {
        removeSpy(input)
      },
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as Action<{ data: { memberId: string } }>,
  },
  play: async ({ args }) => {
    removeSpy.mockClear()
    const body = within(await sheet())
    await userEvent.click(body.getByRole('button', { name: 'Remove' }))
    const confirm = await within(document.body).findByRole('button', {
      name: 'Remove member',
    })
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith({ data: { memberId: 'member-2' } }),
    )
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
  },
}
