// The one search input of a list, in the two forms the product draws it: the
// bordered field of a toolbar (Properties, Portals, Google import) and the bare
// field of a bar that is its own frame (the Inbox's list header). Dark is the
// default theme; the light variants render the same field on the light surface
// (axe runs on both). The Storybook Vitest project compiles no Tailwind, so the
// plays prove structure and behaviour, not geometry.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { SearchField } from './search-field'

type Props = Parameters<typeof SearchField>[0]

function Controlled(
  props: Omit<Props, 'value' | 'onValueChange'> & { initial?: string },
) {
  const { initial = '', ...rest } = props
  const [value, setValue] = useState(initial)
  return <SearchField {...rest} value={value} onValueChange={setValue} />
}

const meta: Meta<typeof Controlled> = {
  title: 'Patterns/Search field',
  component: Controlled,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Search properties', placeholder: 'Search name or address' },
}

export default meta
type Story = StoryObj<typeof Controlled>

/** Empty: a search box with its glyph and no clear button to offer. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('searchbox', { name: 'Search properties' })
    expect(box).toHaveAttribute('placeholder', 'Search name or address')
    expect(box).toHaveAttribute('maxlength', '100')
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** With text: the X appears, named for what it does, and clearing keeps the focus in the field. */
export const Filled: Story = {
  args: { initial: 'rila grand' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('searchbox', { name: 'Search properties' })
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** A list that names its clear differently says so. */
export const NamedClear: Story = {
  args: { initial: 'x', clearLabel: 'Clear the location search' },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Clear the location search' }),
    ).toBeVisible()
  },
}

/** A shorter limit than the shared one, for a list whose URL keeps less. */
export const ShortLimit: Story = {
  args: { maxLength: 8 },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('searchbox')
    await userEvent.click(box)
    await userEvent.paste('abcdefghijkl')
    expect(box).toHaveValue('abcdefgh')
  },
}

/** A caller can give the field the whole row, as Google import does inside a card. */
export const FullWidth: Story = {
  args: { className: 'sm:w-full', label: 'Search loaded Google locations' },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('searchbox', {
        name: 'Search loaded Google locations',
      }),
    ).toBeVisible()
  },
}

const onKeyDown = fn()

/** Bare: a glyph and an input for a bar that is the frame; the bar owns closing, so no X of its own. */
export const Bare: Story = {
  args: {
    variant: 'bare',
    label: 'Search reviews',
    initial: 'breakfast',
    autoFocus: true,
    onKeyDown,
  },
  decorators: [
    (Story) => (
      <div className="flex w-80 items-center border px-4">
        <Story />
      </div>
    ),
  ],
  beforeEach: () => onKeyDown.mockClear(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('searchbox', { name: 'Search reviews' })
    expect(box).toHaveFocus()
    expect(canvas.queryByRole('button')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(onKeyDown).toHaveBeenCalled()
  },
}

export const EmptyLight: Story = { ...Empty, parameters: { theme: 'light' } }
export const FilledLight: Story = {
  args: { initial: 'rila grand' },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Clear search' }),
    ).toBeVisible()
  },
}
export const BareLight: Story = { ...Bare, parameters: { theme: 'light' } }
