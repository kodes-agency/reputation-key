import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { PropertyPublicDisplayNameCard } from './property-public-display-name-card'

type SaveAction = ComponentProps<typeof PropertyPublicDisplayNameCard>['action']
type SaveInput = Parameters<SaveAction>[0]

const noNameSaveSpy = fn(async (_input: SaveInput) => undefined)
const noNameSave = Object.assign(noNameSaveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction

const savedNameSaveSpy = fn(async (_input: SaveInput) => undefined)
const savedNameSave = Object.assign(savedNameSaveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction

const managerSave = Object.assign(
  fn(async (_input: SaveInput) => undefined),
  { isPending: false, error: null, isSuccess: false, data: null },
) as unknown as SaveAction

const meta = {
  title: 'Property/PropertyPublicDisplayNameCard',
  component: PropertyPublicDisplayNameCard,
  decorators: [withRole('AccountAdmin')],
  parameters: { layout: 'centered' },
  args: {
    propertyId: '10000000-0000-4000-8000-000000000101',
    displayName: '',
    action: noNameSave,
  },
} satisfies Meta<typeof PropertyPublicDisplayNameCard>

export default meta
type Story = StoryObj<typeof meta>

export const NoPortalRequired: Story = {
  play: async ({ canvasElement }) => {
    noNameSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const displayName = canvas.getByLabelText('Public display name')

    expect(displayName).toBeEnabled()
    await userEvent.type(displayName, 'Harborline Suites')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save public display name' }),
    )

    await waitFor(() =>
      expect(noNameSaveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: '10000000-0000-4000-8000-000000000101',
          displayName: 'Harborline Suites',
        },
      }),
    )
  },
}

// The name is the only thing this card writes. A save used to carry the colours the
// page was opened with, so a colour changed in Property look in the meantime came
// back as the old one; now the command has no colour in it to restore.
export const SavingTheNameSendsNoColours: Story = {
  args: {
    displayName: 'Harborline Hotel',
    action: savedNameSave,
  },
  play: async ({ canvasElement }) => {
    savedNameSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const displayName = canvas.getByLabelText('Public display name')
    expect(displayName).toHaveValue('Harborline Hotel')

    await userEvent.clear(displayName)
    await userEvent.type(displayName, 'Harborline Suites')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save public display name' }),
    )

    await waitFor(() => expect(savedNameSaveSpy).toHaveBeenCalledTimes(1))
    const [input] = savedNameSaveSpy.mock.calls[0] ?? []
    expect(Object.keys(input?.data ?? {}).sort()).toEqual(['displayName', 'propertyId'])
    expect(input).toEqual({
      data: {
        propertyId: '10000000-0000-4000-8000-000000000101',
        displayName: 'Harborline Suites',
      },
    })
  },
}

export const PropertyManagerIsReadOnly: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    displayName: 'Harborline Hotel',
    action: managerSave,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getByLabelText('Public display name')).toBeDisabled()
    expect(canvas.getByText(/ask an account admin to set this property/i)).toBeVisible()
    expect(
      canvas.queryByRole('button', { name: 'Save public display name' }),
    ).not.toBeInTheDocument()
  },
}

export const ResetEmptiesTheUnsavedName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()
    const displayName = canvas.getByLabelText('Public display name')
    await userEvent.type(displayName, 'Harborline')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(displayName).toHaveValue('')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
  },
}
