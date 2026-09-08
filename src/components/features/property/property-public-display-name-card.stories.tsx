import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { PropertyPublicDisplayNameCard } from './property-public-display-name-card'

type SaveAction = ComponentProps<typeof PropertyPublicDisplayNameCard>['action']
type SaveInput = Parameters<SaveAction>[0]

const noProfileSaveSpy = fn(async (_input: SaveInput) => undefined)
const noProfileSave = Object.assign(noProfileSaveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction

const existingProfileSaveSpy = fn(async (_input: SaveInput) => undefined)
const existingProfileSave = Object.assign(existingProfileSaveSpy, {
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
    profile: null,
    action: noProfileSave,
  },
} satisfies Meta<typeof PropertyPublicDisplayNameCard>

export default meta
type Story = StoryObj<typeof meta>

export const NoPortalRequired: Story = {
  play: async ({ canvasElement }) => {
    noProfileSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const displayName = canvas.getByLabelText('Public display name')

    expect(displayName).toBeEnabled()
    await userEvent.type(displayName, 'Harborline Suites')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save public display name' }),
    )

    await waitFor(() =>
      expect(noProfileSaveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: '10000000-0000-4000-8000-000000000101',
          displayName: 'Harborline Suites',
          primaryColor: '#2563EB',
          backgroundColor: '#FFFFFF',
          textColor: '#111827',
        },
      }),
    )
  },
}

export const ExistingProfilePreservesPortalTheme: Story = {
  args: {
    profile: {
      displayName: 'Harborline Hotel',
      primaryColor: '#123456',
      backgroundColor: '#FDFCFB',
      textColor: '#101820',
    },
    action: existingProfileSave,
  },
  play: async ({ canvasElement }) => {
    existingProfileSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const displayName = canvas.getByLabelText('Public display name')

    await userEvent.clear(displayName)
    await userEvent.type(displayName, 'Harborline Suites')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save public display name' }),
    )

    await waitFor(() =>
      expect(existingProfileSaveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: '10000000-0000-4000-8000-000000000101',
          displayName: 'Harborline Suites',
          primaryColor: '#123456',
          backgroundColor: '#FDFCFB',
          textColor: '#101820',
        },
      }),
    )
  },
}

export const PropertyManagerIsReadOnly: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    profile: {
      displayName: 'Harborline Hotel',
      primaryColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
    },
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
