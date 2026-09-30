// The segmented control, with no domain around it. The Storybook Vitest project
// compiles no Tailwind, so nothing here claims a pixel; the plays prove the
// behaviour a screenshot cannot: exactly one radio is checked, the arrow keys
// move the choice and focus together (wrapping at the ends), a disabled option
// is skipped, and each abbreviation's accessible name is the label then the full name.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SegmentedControl, type SegmentedControlOption } from './segmented-control'

const meta: Meta<typeof SegmentedControl> = {
  title: 'UI/Segmented Control',
  component: SegmentedControl,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof SegmentedControl>

const LANGUAGES: ReadonlyArray<SegmentedControlOption> = [
  { value: 'en', label: 'EN', accessibleLabel: 'English' },
  { value: 'bg', label: 'BG', accessibleLabel: 'Bulgarian' },
  { value: 'es', label: 'ES', accessibleLabel: 'Spanish', disabled: true },
  { value: 'de', label: 'DE', accessibleLabel: 'German' },
]

function Controlled({
  initial,
  options,
  label,
}: Readonly<{
  initial: string
  options: ReadonlyArray<SegmentedControlOption>
  label: string
}>) {
  const [value, setValue] = useState(initial)
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={setValue}
      options={options}
    />
  )
}

/** The chosen option, by its accessible name. */
function checkedName(canvasElement: HTMLElement): string | null {
  const checked = canvasElement.querySelector('[role="radio"][aria-checked="true"]')
  return checked?.textContent?.trim() ?? null
}

export const Languages: Story = {
  render: () => <Controlled initial="en" options={LANGUAGES} label="Preview language" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('radiogroup', { name: 'Preview language' }),
    ).toBeInTheDocument()
    expect(canvas.getAllByRole('radio')).toHaveLength(4)
    expect(canvasElement.querySelectorAll('[aria-checked="true"]')).toHaveLength(1)
    // The abbreviation is the label; the full name is the accessible name.
    expect(canvas.getByRole('radio', { name: 'EN English' })).toBeChecked()
    expect(canvas.getByRole('radio', { name: 'BG Bulgarian' })).not.toBeChecked()
  },
}

/** Clicking a segment moves the choice; there is no way to end up with none. */
export const ClickChooses: Story = {
  render: () => <Controlled initial="en" options={LANGUAGES} label="Preview language" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'DE German' }))
    expect(canvas.getByRole('radio', { name: 'DE German' })).toBeChecked()
    // Choosing the chosen one again leaves it chosen.
    await userEvent.click(canvas.getByRole('radio', { name: 'DE German' }))
    expect(canvasElement.querySelectorAll('[aria-checked="true"]')).toHaveLength(1)
    expect(checkedName(canvasElement)).toBe('DE')
  },
}

/** Arrow keys move the choice and focus together, skip a disabled option, and wrap. */
export const ArrowKeys: Story = {
  render: () => <Controlled initial="en" options={LANGUAGES} label="Preview language" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Radix moves focus on a timer after the key, then checks the radio that
    // received it only while the arrow is still held. A real key press lasts
    // tens of milliseconds; `userEvent.keyboard('{ArrowRight}')` releases it in
    // the same tick, so the key is held until focus has arrived.
    async function arrowTo(key: 'ArrowRight' | 'ArrowLeft', name: string) {
      await userEvent.keyboard(`{${key}>}`)
      await waitFor(() => expect(canvas.getByRole('radio', { name })).toHaveFocus())
      await userEvent.keyboard(`{/${key}}`)
      expect(canvas.getByRole('radio', { name })).toBeChecked()
    }
    canvas.getByRole('radio', { name: 'EN English' }).focus()

    await arrowTo('ArrowRight', 'BG Bulgarian')
    // Spanish is disabled: the next arrow lands on German.
    await arrowTo('ArrowRight', 'DE German')
    // And past the end it wraps to the first.
    await arrowTo('ArrowRight', 'EN English')
    await arrowTo('ArrowLeft', 'DE German')
  },
}

/** Tab enters the group once, on the chosen segment, and leaves it. */
export const OneTabStop: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <button type="button">Before</button>
      <Controlled initial="bg" options={LANGUAGES} label="Preview language" />
      <button type="button">After</button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Before' }).focus()
    await userEvent.tab()
    expect(canvas.getByRole('radio', { name: 'BG Bulgarian' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'After' })).toHaveFocus()
  },
}

/** A label that already says everything needs no extra name. */
export const PlainLabels: Story = {
  render: () => (
    <Controlled
      initial="90"
      label="Time range"
      options={[
        { value: '30', label: '30 days' },
        { value: '90', label: '90 days' },
        { value: '180', label: '6 months' },
        { value: 'all', label: 'All time' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('radio', { name: '90 days' })).toBeChecked()
    expect(
      canvasElement.querySelector('[aria-label]:not([role="radiogroup"])'),
    ).toBeNull()
  },
}
