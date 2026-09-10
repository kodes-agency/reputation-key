import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { PropertyReplyProfileCard } from './property-reply-profile-card'

type SaveAction = ComponentProps<typeof PropertyReplyProfileCard>['action']
type SaveInput = Parameters<SaveAction>[0]

const emptySaveSpy = fn(async (_input: SaveInput) => undefined)
const emptySave = Object.assign(emptySaveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction
const populatedSaveSpy = fn(async (_input: SaveInput) => undefined)
const populatedSave = Object.assign(populatedSaveSpy, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as SaveAction

const meta = {
  title: 'Property/PropertyReplyProfileCard',
  component: PropertyReplyProfileCard,
  decorators: [
    withRole('AccountAdmin'),
    (Story) => (
      <div className="w-[min(56rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'centered' },
  args: {
    propertyId: '75000000-0000-4000-8000-000000000001',
    profile: null,
    action: emptySave,
  },
} satisfies Meta<typeof PropertyReplyProfileCard>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    emptySaveSpy.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.getByLabelText('Greeting')).toBeEnabled()
    expect(canvas.getByLabelText('Positive sign-off')).toHaveValue('')
    await userEvent.click(canvas.getByRole('button', { name: 'Save reply profile' }))
    await waitFor(() =>
      expect(emptySaveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: '75000000-0000-4000-8000-000000000001',
          profile: {
            greeting: '',
            signOffPositive: '',
            signOffNegative: '',
            emojiAllowed: false,
            escalationContact: null,
          },
        },
      }),
    )
  },
}

export const Populated: Story = {
  args: {
    profile: {
      greeting: 'Dear {guest_name},',
      signOffPositive: 'Warm regards,\nHarborline team',
      signOffNegative: 'Sincerely,\nGuest relations',
      emojiAllowed: false,
      escalationContact: 'care@harborline.example',
      version: 3,
    },
    action: populatedSave,
  },
  play: async ({ canvasElement }) => {
    populatedSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const greeting = canvas.getByLabelText('Greeting')

    expect(greeting).toHaveValue('Dear {guest_name},')
    await userEvent.clear(greeting)
    await userEvent.click(greeting)
    await userEvent.paste('Hello {guest_name},')
    await userEvent.click(canvas.getByLabelText('Allow emoji in rendered templates'))
    await userEvent.click(canvas.getByRole('button', { name: 'Save reply profile' }))

    await waitFor(() =>
      expect(populatedSaveSpy).toHaveBeenCalledWith({
        data: {
          propertyId: '75000000-0000-4000-8000-000000000001',
          profile: {
            greeting: 'Hello {guest_name},',
            signOffPositive: 'Warm regards,\nHarborline team',
            signOffNegative: 'Sincerely,\nGuest relations',
            emojiAllowed: true,
            escalationContact: 'care@harborline.example',
          },
        },
      }),
    )
  },
}

export const UnsupportedSlot: Story = {
  args: { action: populatedSave },
  play: async ({ canvasElement }) => {
    populatedSaveSpy.mockClear()
    const canvas = within(canvasElement)
    const greeting = canvas.getByLabelText('Greeting')

    await userEvent.click(greeting)
    await userEvent.paste('Hello {property_name}')
    await userEvent.click(canvas.getByRole('button', { name: 'Save reply profile' }))

    expect(
      await canvas.findByText('Unsupported reply template slot: {property_name}'),
    ).toBeVisible()
    expect(populatedSaveSpy).not.toHaveBeenCalled()
  },
}

export const PermissionDenied: Story = {
  decorators: [withRole('Member')],
  args: {
    profile: {
      greeting: 'Dear {guest_name},',
      signOffPositive: 'Warm regards',
      signOffNegative: 'Sincerely',
      emojiAllowed: false,
      escalationContact: null,
      version: 1,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getByLabelText('Greeting')).toBeDisabled()
    expect(canvas.getByLabelText('Allow emoji in rendered templates')).toBeDisabled()
    expect(canvas.getByText(/ask a property manager or account admin/i)).toBeVisible()
    expect(
      canvas.queryByRole('button', { name: 'Save reply profile' }),
    ).not.toBeInTheDocument()
  },
}
