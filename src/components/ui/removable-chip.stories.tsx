// A choice made, as a pill you press to take back: the Inbox's active filters and
// the member invitation's assigned properties. Dark is the default theme; the
// light variant renders the same row on the light surface (axe runs on both). The
// Storybook Vitest project compiles no Tailwind, so the plays prove the
// behaviour a screenshot cannot: the whole chip is the button, its name says what
// pressing it does, and the keyboard reaches and removes it.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { RemovableChip } from './removable-chip'

function Row({ initial }: Readonly<{ initial: ReadonlyArray<string> }>) {
  const [labels, setLabels] = useState(initial)
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Chosen properties">
      {labels.map((label) => (
        <RemovableChip
          key={label}
          label={label}
          removeLabel={`Remove ${label}`}
          onRemove={() =>
            setLabels((current) => current.filter((item) => item !== label))
          }
        />
      ))}
    </div>
  )
}

const meta: Meta<typeof Row> = {
  title: 'Patterns/Removable chip',
  component: Row,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { initial: ['Rila Grand Hotel', 'Café Plaza', 'Harborline Suites'] },
}

export default meta
type Story = StoryObj<typeof Row>

/** Every chip is one button named for its removal, not for its text alone. */
export const Chips: Story = {
  play: async ({ canvasElement }) => {
    const group = within(
      within(canvasElement).getByRole('group', { name: 'Chosen properties' }),
    )
    const names = group
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual([
      'Remove Rila Grand Hotel',
      'Remove Café Plaza',
      'Remove Harborline Suites',
    ])
  },
}

/** Pressing the chip, anywhere on it, takes it back. */
export const RemoveWithAPress: Story = {
  play: async ({ canvasElement }) => {
    const group = within(
      within(canvasElement).getByRole('group', { name: 'Chosen properties' }),
    )
    await userEvent.click(group.getByRole('button', { name: 'Remove Café Plaza' }))
    expect(group.queryByRole('button', { name: 'Remove Café Plaza' })).toBeNull()
    expect(group.getAllByRole('button')).toHaveLength(2)
  },
}

/** The keyboard reaches each chip in turn and Enter removes the one in focus. */
export const RemoveFromTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const group = within(
      within(canvasElement).getByRole('group', { name: 'Chosen properties' }),
    )
    await userEvent.tab()
    expect(group.getByRole('button', { name: 'Remove Rila Grand Hotel' })).toHaveFocus()
    await userEvent.tab()
    expect(group.getByRole('button', { name: 'Remove Café Plaza' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(group.queryByRole('button', { name: 'Remove Café Plaza' })).toBeNull()
  },
}

export const ChipsLight: Story = { ...Chips, parameters: { theme: 'light' } }
