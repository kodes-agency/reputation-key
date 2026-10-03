// The range control (UI consistency scan: NAV-08, ACT-11, ACT-18, COLL-14): a
// segmented control where a row of segments fits, a Select below `sm`, one name
// either way. The page brings its own preset list; the dashboard's four and the
// Portal Results' five are the two in use. Dark is the default theme; the light
// variant draws the same rows on the light surface (axe runs on both).
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { RangeControl, type RangeOption } from './range-control'

const meta: Meta = {
  title: 'Patterns/Range control',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

const DASHBOARD: ReadonlyArray<RangeOption<string>> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '6 months' },
  { value: 'all', label: 'All time' },
]

const PORTAL_RESULTS: ReadonlyArray<RangeOption<string>> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '60d', label: 'Last 60 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const onChange = fn()

function Controlled({
  initial,
  options,
}: Readonly<{ initial: string; options: ReadonlyArray<RangeOption<string>> }>) {
  const [value, setValue] = useState(initial)
  return (
    <RangeControl
      value={value}
      options={options}
      onValueChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

/** The page's four presets: one radio group, the current range checked. */
export const DashboardRanges: Story = {
  render: () => <Controlled initial="90d" options={DASHBOARD} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('radiogroup', { name: 'Time range' })
    for (const label of ['30 days', '90 days', '6 months', 'All time']) {
      expect(within(group).getByRole('radio', { name: label })).toBeVisible()
    }
    expect(within(group).getByRole('radio', { name: '90 days' })).toBeChecked()
    // The same options stand in as a Select below `sm`, under the same name. CSS
    // shows one at a time; the Storybook Vitest project compiles no Tailwind, so
    // here both are in the tree.
    expect(canvas.getByRole('combobox', { name: 'Time range' })).toHaveTextContent(
      '90 days',
    )
  },
}

/** Choosing a segment reports the option's value, and the choice moves. */
export const Choosing: Story = {
  render: () => <Controlled initial="90d" options={DASHBOARD} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onChange.mockClear()
    await userEvent.click(canvas.getByRole('radio', { name: '6 months' }))
    expect(onChange).toHaveBeenCalledWith('180d')
    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: '6 months' })).toBeChecked(),
    )
    expect(canvas.getByRole('radio', { name: '90 days' })).not.toBeChecked()
  },
}

/** Portal Results keeps its own presets (7 to 90 days, All time) in the same shell. */
export const PortalResultsPresets: Story = {
  render: () => <Controlled initial="30d" options={PORTAL_RESULTS} />,
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Time range' })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    expect(within(group).getByRole('radio', { name: 'Last 7 days' })).toBeVisible()
    expect(within(group).getByRole('radio', { name: 'Last 30 days' })).toBeChecked()
  },
}

/**
 * Below `sm` the same options are a Select, still named "Time range". The play
 * drives the Select, which is what a phone sees, and proves it commits a choice
 * and prints it. The height is not asserted: the Storybook Vitest project
 * compiles no Tailwind, so the 44px token cannot show here.
 */
export const Phone320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  render: () => <Controlled initial="90d" options={DASHBOARD} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onChange.mockClear()
    const select = canvas.getByRole('combobox', { name: 'Time range' })
    await userEvent.click(select)
    const content = select.ownerDocument.getElementById(
      select.getAttribute('aria-controls') ?? '',
    )
    if (!content) throw new Error('The Select did not open')
    await userEvent.click(within(content).getByRole('option', { name: '30 days' }))
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('30d')
      expect(select).toHaveTextContent('30 days')
    })
    // The segments follow: one control, one value.
    expect(canvas.getByRole('radio', { name: '30 days' })).toBeChecked()
  },
}

export const DashboardRangesLight: Story = {
  ...DashboardRanges,
  parameters: { theme: 'light' },
}
export const PortalResultsPresetsLight: Story = {
  ...PortalResultsPresets,
  parameters: { theme: 'light' },
}
