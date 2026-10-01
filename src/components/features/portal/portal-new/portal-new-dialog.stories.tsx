import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { CreatePortalInput } from '#/contexts/portal/application/dto/create-portal.dto'
import { PortalNewDialog } from './portal-new-dialog'
import type { PortalNewData } from './portal-new-types'

type CreateInput = { data: CreatePortalInput }

const createSpy = fn(async (_input: CreateInput) => undefined)

const action = (
  state: { isPending?: boolean; error?: unknown } = {},
): Action<CreateInput> =>
  Object.assign((input: CreateInput) => createSpy(input), {
    isPending: state.isPending ?? false,
    error: state.error ?? null,
    isSuccess: false,
    data: null,
  })

const data: PortalNewData = {
  propertyId: 'property-1',
  propertyName: 'Avela Resort',
  options: {
    defaultGuestLocales: ['en'],
    eligibleManagerUserIds: ['me', 'anna'],
    creatorIsEligible: true,
  },
  groups: [
    { id: 'group-1', name: 'Pool side' },
    { id: 'group-2', name: 'Front of house' },
  ],
  sources: [
    {
      portalId: 'portal-1',
      name: 'Pool & Terrace',
      primaryGuestLocale: 'bg',
      additionalGuestLocales: ['en'],
    },
    {
      portalId: 'portal-2',
      name: 'Reception',
      primaryGuestLocale: 'en',
      additionalGuestLocales: [],
    },
  ],
  members: [
    { userId: 'me', name: 'Gina Iliev' },
    { userId: 'anna', name: 'Anna Petrova' },
  ],
  creatorId: 'me',
  mutation: action(),
}

/** Presses Create draft and returns what the dialog sent. */
async function submitted(ui: ReturnType<typeof within>) {
  await userEvent.click(ui.getByRole('button', { name: 'Create draft' }))
  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
  return createSpy.mock.calls[0]?.[0].data
}

/** Names the portal and picks "A copy of another portal" as its start. */
async function nameAndCopy(ui: ReturnType<typeof within>) {
  await userEvent.type(ui.getByLabelText('Name'), 'Rooftop pool')
  await userEvent.click(ui.getByRole('radio', { name: /A copy of another portal/ }))
}

const meta: Meta<typeof PortalNewDialog> = {
  title: 'Portal/PortalNewDialog',
  component: PortalNewDialog,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), data },
  beforeEach: () => {
    createSpy.mockClear()
  },
}
export default meta
type Story = StoryObj<typeof PortalNewDialog>

const dialog = () => within(screen.getByRole('dialog'))

export const Default: Story = {
  play: async () => {
    const ui = dialog()
    await expect(ui.getByRole('heading', { name: 'New portal' })).toBeInTheDocument()
    await expect(ui.getByLabelText('Name')).toHaveFocus()
    await expect(ui.getByLabelText('Group')).toBeInTheDocument()
    await expect(ui.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(ui.getByText(/Guests see the page in English/)).toBeInTheDocument()
    await expect(
      ui.getByText("You'll be responsible for this portal"),
    ).toBeInTheDocument()
    await expect(ui.getByText('Nothing is public until you publish.')).toBeInTheDocument()
    // No place types: the dialog never asks where guests will find the portal.
    await expect(ui.queryByText(/where will guests find it/i)).toBeNull()
  },
}

export const CreatesADraft: Story = {
  play: async () => {
    const ui = dialog()
    await userEvent.type(ui.getByLabelText('Name'), 'Rooftop pool')
    // Choices left at their defaults are not sent: no group, the creator as manager.
    await expect(await submitted(ui)).toEqual({
      propertyId: 'property-1',
      name: 'Rooftop pool',
      guestLocales: ['en'],
      startFrom: { kind: 'property' },
    })
  },
}

export const StartsFromACopy: Story = {
  play: async () => {
    const ui = dialog()
    await nameAndCopy(ui)
    // The copy brings the languages of the portal it copies.
    await userEvent.click(ui.getByRole('combobox', { name: 'Portal to copy' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Pool & Terrace' }))
    await waitFor(() =>
      expect(ui.getByRole('button', { name: 'Български' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    await expect(await submitted(ui)).toEqual({
      propertyId: 'property-1',
      name: 'Rooftop pool',
      guestLocales: ['bg', 'en'],
      startFrom: { kind: 'portal', portalId: 'portal-1' },
    })
  },
}

export const NeedsAPortalToCopy: Story = {
  play: async () => {
    const ui = dialog()
    await nameAndCopy(ui)
    await userEvent.click(ui.getByRole('button', { name: 'Create draft' }))
    await expect(await ui.findByText('Choose the portal to copy')).toBeInTheDocument()
    await expect(createSpy).not.toHaveBeenCalled()
  },
}

export const NeedsAName: Story = {
  play: async () => {
    const ui = dialog()
    await userEvent.click(ui.getByRole('button', { name: 'Create draft' }))
    await expect(await ui.findByText('Give the portal a name')).toBeInTheDocument()
    await expect(createSpy).not.toHaveBeenCalled()
  },
}

export const SendsTheChoices: Story = {
  play: async () => {
    const ui = dialog()
    await userEvent.click(ui.getByLabelText('Group'))
    await userEvent.click(await screen.findByRole('option', { name: 'Pool side' }))
    // Let the listbox finish closing before the next control takes focus.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    await userEvent.click(ui.getByRole('button', { name: 'Add language' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Български' }))
    await userEvent.click(ui.getByRole('button', { name: 'Change' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Anna Petrova' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(ui.getByLabelText('Name'), '  Rooftop pool ')
    await expect(await submitted(ui)).toEqual({
      propertyId: 'property-1',
      name: 'Rooftop pool',
      guestLocales: ['en', 'bg'],
      startFrom: { kind: 'property' },
      groupId: 'group-1',
      responsibleManagerUserIds: ['me', 'anna'],
    })
  },
}

export const OneGroupOrNone: Story = {
  args: { data: { ...data, groups: [], sources: [] } },
  play: async () => {
    const ui = dialog()
    // Nothing to choose, so nothing is asked.
    await expect(ui.queryByLabelText('Group')).toBeNull()
    await expect(ui.queryByRole('radio', { name: /A copy of another portal/ })).toBeNull()
  },
}

export const NobodyResponsibleByDefault: Story = {
  args: {
    data: {
      ...data,
      options: { ...data.options, creatorIsEligible: false },
    },
  },
  play: async () => {
    await expect(dialog().getByText('No one will be responsible yet')).toBeInTheDocument()
  },
}

export const Saving: Story = {
  args: { data: { ...data, mutation: action({ isPending: true }) } },
  play: async () => {
    await expect(dialog().getByRole('button', { name: /Create draft/ })).toBeDisabled()
  },
}

export const Refused: Story = {
  args: {
    data: {
      ...data,
      mutation: action({ error: new Error('This role cannot create portals.') }),
    },
  },
  play: async () => {
    await expect(
      await dialog().findByText(/This role cannot create portals/),
    ).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { data: null },
  play: async () => {
    await expect(dialog().getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  },
}

export const OptionsFailed: Story = {
  args: { data: null, loadError: new Error('Portals are not available right now.') },
  play: async () => {
    await expect(
      await dialog().findByText(/Portals are not available right now/),
    ).toBeInTheDocument()
    await expect(dialog().queryByLabelText('Name')).toBeNull()
  },
}

export const Light: Story = {
  parameters: { theme: 'light' },
  play: Default.play,
}
