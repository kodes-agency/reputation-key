import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  PropertyReplyLanguageCard,
  type PropertyReplyLanguageUpdateAction,
} from './property-reply-language-card'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const updateProperty = Object.assign(
  fn(async (input: Parameters<PropertyReplyLanguageUpdateAction>[0]) => ({
    property: {
      id: input.data.propertyId,
      defaultReplyLanguage: input.data.defaultReplyLanguage,
    },
  })),
  {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  },
) satisfies PropertyReplyLanguageUpdateAction

const meta = {
  title: 'Settings/PropertyReplyLanguageCard',
  component: PropertyReplyLanguageCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    property: {
      id: PROPERTY_ID,
      name: 'Hotel Elegance',
      defaultReplyLanguage: null,
    },
    updateProperty,
  },
} satisfies Meta<typeof PropertyReplyLanguageCard>

export default meta
type Story = StoryObj<typeof meta>

export const ExplicitlyUnconfigured: Story = {
  play: async ({ canvasElement }) => {
    updateProperty.mockClear()
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)

    expect(
      canvas.getByText('Not configured', { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument()
    expect(canvas.getByText(/never inferred from the property country/i)).toBeVisible()
    await userEvent.click(canvas.getByLabelText('Property default'))
    await userEvent.click(
      await page.findByRole('option', {
        name: 'Bulgarian (Cyrillic)',
      }),
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Save reply language' }))

    await waitFor(() => expect(updateProperty).toHaveBeenCalledOnce())
    expect(updateProperty).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        defaultReplyLanguage: 'bg-Cyrl',
      },
    })
  },
}

export const ConfiguredCanBeClearedExplicitly: Story = {
  args: {
    property: {
      id: PROPERTY_ID,
      name: 'Hotel Elegance',
      defaultReplyLanguage: 'tr-Latn',
    },
  },
  play: async ({ canvasElement }) => {
    updateProperty.mockClear()
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)

    expect(canvas.getByText('Configured')).toBeInTheDocument()
    await userEvent.click(canvas.getByLabelText('Property default'))
    await userEvent.click(await page.findByRole('option', { name: 'Not configured' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save reply language' }))

    await waitFor(() => expect(updateProperty).toHaveBeenCalledOnce())
    expect(updateProperty).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        defaultReplyLanguage: null,
      },
    })
  },
}
