import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  PropertyReplyLanguageCard,
  type PropertyReplyLanguageUpdateAction,
} from './property-reply-language-card'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const createUpdateProperty = () =>
  Object.assign(
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

const configureReplyLanguage = createUpdateProperty()
const clearReplyLanguage = createUpdateProperty()

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
    updateProperty: configureReplyLanguage,
  },
} satisfies Meta<typeof PropertyReplyLanguageCard>

export default meta
type Story = StoryObj<typeof meta>

export const ExplicitlyUnconfigured: Story = {
  play: async ({ canvasElement }) => {
    configureReplyLanguage.mockClear()
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
    // findBy, not getBy: while the Select overlay is open Radix marks the rest
    // of the page aria-hidden, and the query would run before that cleanup.
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Save reply language' }),
    )

    await waitFor(() => expect(configureReplyLanguage).toHaveBeenCalledOnce())
    expect(configureReplyLanguage).toHaveBeenCalledWith({
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
    updateProperty: clearReplyLanguage,
  },
  play: async ({ canvasElement }) => {
    clearReplyLanguage.mockClear()
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)

    expect(canvas.getByText('Configured')).toBeInTheDocument()
    await userEvent.click(canvas.getByLabelText('Property default'))
    await userEvent.click(await page.findByRole('option', { name: 'Not configured' }))
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Save reply language' }),
    )

    await waitFor(() => expect(clearReplyLanguage).toHaveBeenCalledOnce())
    expect(clearReplyLanguage).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY_ID,
        defaultReplyLanguage: null,
      },
    })
  },
}
