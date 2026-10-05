// RatingThresholdField: "how low a rating" as one field. Dark is the default theme; the
// light variants render the same fields on the light surface (axe runs on both). The
// Storybook Vitest project compiles no Tailwind, so the plays pin behaviour and wiring
// (the options and their words, the Off choice, the chosen value, the spoken form), not
// colours.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { LOW_RATING_THRESHOLDS } from '#/contexts/feed/application/public-api'
import { RatingThresholdField } from './rating-threshold-field'

/** The Portal editor's private note and the Organization's low-rating target: one of five ratings. */
function FiveRatings({ invalid = false }: Readonly<{ invalid?: boolean }>) {
  const [value, setValue] = useState(3)
  return (
    <div className="max-w-sm">
      <RatingThresholdField
        id="story-threshold"
        label="Private feedback threshold"
        value={value}
        onValueChange={setValue}
        invalid={invalid}
        errors={invalid ? [{ message: 'Choose how low a rating is' }] : undefined}
        description="Controls when optional private feedback appears after the private rating."
      />
    </div>
  )
}

/** The notification page's channel: Off, then one to four stars, named for its category. */
function PerChannel() {
  const [value, setValue] = useState<number | null>(3)
  return (
    <div className="max-w-sm">
      <RatingThresholdField
        id="story-channel"
        label="In the app"
        accessibleName="Low ratings: In the app"
        offLabel="Off"
        thresholds={LOW_RATING_THRESHOLDS}
        value={value}
        onValueChange={setValue}
        className="w-auto"
        triggerClassName="w-40"
      />
    </div>
  )
}

const meta: Meta = {
  title: 'Patterns/Rating threshold field',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

const body = () => within(document.body)

/** Five ratings, "N★ or lower" on screen and "N stars or lower" aloud; the lowest has nothing below it. */
export const FiveRatingsOffered: Story = {
  render: () => <FiveRatings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Private feedback threshold' })
    expect(select).toHaveTextContent('3 stars or lower')
    expect(select).toHaveAccessibleDescription(
      'Controls when optional private feedback appears after the private rating.',
    )

    await userEvent.click(select)
    const options = await body().findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '1★ only1 star only',
      '2★ or lower2 stars or lower',
      '3★ or lower3 stars or lower',
      '4★ or lower4 stars or lower',
      '5★ or lower5 stars or lower',
    ])

    await userEvent.click(body().getByRole('option', { name: '1 star only' }))
    expect(select).toHaveTextContent('1 star only')
  },
}

export const FiveRatingsOfferedLight: Story = {
  ...FiveRatingsOffered,
  parameters: { theme: 'light' },
}

/** Off is the first choice where the caller offers it, and the ratings stop at four. */
export const OffThenFourRatings: Story = {
  render: () => <PerChannel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Low ratings: In the app' })

    await userEvent.click(select)
    const options = await body().findAllByRole('option')
    expect(options.map((option) => option.textContent?.slice(0, 3))).toEqual([
      'Off',
      '1★ ',
      '2★ ',
      '3★ ',
      '4★ ',
    ])

    await userEvent.click(body().getByRole('option', { name: 'Off' }))
    expect(select).toHaveTextContent('Off')
  },
}

export const OffThenFourRatingsLight: Story = {
  ...OffThenFourRatings,
  parameters: { theme: 'light' },
}

/** A refused value says why, under the help. */
export const Refused: Story = {
  render: () => <FiveRatings invalid />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Private feedback threshold' })

    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(canvas.getByRole('alert')).toHaveTextContent('Choose how low a rating is')
  },
}

export const RefusedLight: Story = { ...Refused, parameters: { theme: 'light' } }
