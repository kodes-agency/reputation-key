// The slider, with no domain around it. The Storybook Vitest project compiles no
// Tailwind, so nothing here claims a pixel; the plays prove what a screenshot
// cannot: the keys move the value a step at a time, Home and End go to the ends,
// a `limit` short of `max` is the highest value the thumb takes and the one the
// slider announces, and the value is read as the caller's words.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { Slider } from './slider'

const meta: Meta<typeof Slider> = {
  title: 'UI/Slider',
  component: Slider,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Slider>

const tenth = (value: number) => (value / 10).toFixed(1)

function Controlled({ limit }: Readonly<{ limit?: number }>) {
  const [value, setValue] = useState(44)
  return (
    <div className="flex max-w-md flex-col gap-2">
      <p id="slider-story-label" className="text-sm font-medium">
        Goal on Google
      </p>
      <Slider
        aria-labelledby="slider-story-label"
        value={value}
        onValueChange={setValue}
        min={44}
        max={50}
        limit={limit}
        valueText={(next) => `${tenth(next)} stars`}
      />
      <output className="text-sm tabular-nums">{tenth(value)}</output>
    </div>
  )
}

export const KeysMoveTheValue: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thumb = canvas.getByRole('slider', { name: 'Goal on Google' })
    await expect(thumb).toHaveAttribute('aria-valuenow', '44')
    await expect(thumb).toHaveAttribute('aria-valuetext', '4.4 stars')

    thumb.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(thumb).toHaveAttribute('aria-valuenow', '46')
    await expect(thumb).toHaveAttribute('aria-valuetext', '4.6 stars')
    await userEvent.keyboard('{ArrowLeft}')
    await expect(canvas.getByText('4.5')).toBeVisible()

    await userEvent.keyboard('{End}')
    await expect(thumb).toHaveAttribute('aria-valuenow', '50')
    await userEvent.keyboard('{Home}')
    await expect(thumb).toHaveAttribute('aria-valuenow', '44')
  },
}

/** 5.0 is on the scale and out of reach: the thumb stops at 4.9 and says so. */
export const LimitShortOfTheEnd: Story = {
  render: () => <Controlled limit={49} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thumb = canvas.getByRole('slider', { name: 'Goal on Google' })
    await expect(thumb).toHaveAttribute('aria-valuemax', '49')
    await expect(thumb).toHaveAttribute('aria-valuemin', '44')

    thumb.focus()
    await userEvent.keyboard('{End}')
    await expect(thumb).toHaveAttribute('aria-valuenow', '49')
    await expect(thumb).toHaveAttribute('aria-valuetext', '4.9 stars')
    await userEvent.keyboard('{ArrowRight}')
    await expect(thumb).toHaveAttribute('aria-valuenow', '49')
    await expect(
      canvasElement.querySelector('[data-slot="slider-beyond"]'),
    ).toBeInTheDocument()
  },
}

export const Light: Story = {
  render: () => <Controlled limit={49} />,
  parameters: { theme: 'light' },
}
