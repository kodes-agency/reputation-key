// Read-only label/value rows. Dark is the default theme; the light variant renders
// the same list on the light surface (axe runs on both). The Storybook Vitest
// project compiles no Tailwind, so the plays pin structure (a named list, each value
// after its term, a note under its value); the term column and the phone stacking
// are `sm:` classes read in a browser.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { DescriptionItem, DescriptionList } from './description-list'

const meta: Meta<typeof DescriptionList> = {
  title: 'Patterns/Description list',
  component: DescriptionList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { 'aria-label': 'Google profile' },
  render: (args) => (
    <DescriptionList {...args}>
      <DescriptionItem term="Status">Connected</DescriptionItem>
      <DescriptionItem term="Business name" note="From Google">
        Harborline Suites
      </DescriptionItem>
      <DescriptionItem term="Address">
        12 Harbour Road, Varna 9000, Bulgaria
      </DescriptionItem>
      <DescriptionItem term="Title" lang="bg">
        Добре дошли
      </DescriptionItem>
    </DescriptionList>
  ),
}

export default meta
type Story = StoryObj<typeof DescriptionList>

/** Each term is followed by its value, in the order written. */
export const Default: Story = {
  play: ({ canvasElement }) => {
    const list = within(canvasElement).getByLabelText('Google profile')
    expect(list.tagName).toBe('DL')
    const rows = [...list.querySelectorAll(':scope > div')].map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ])
    expect(rows).toEqual([
      ['Status', 'Connected'],
      ['Business name', 'Harborline SuitesFrom Google'],
      ['Address', '12 Harbour Road, Varna 9000, Bulgaria'],
      ['Title', 'Добре дошли'],
    ])
  },
}

export const DefaultLight: Story = {
  ...Default,
  parameters: { theme: 'light' },
}

/** A longer term gets the wide column. */
export const WideTerms: Story = {
  args: { termWidth: 'wide' },
  render: (args) => (
    <DescriptionList {...args}>
      <DescriptionItem term="Responsible manager">Anna Petrova</DescriptionItem>
      <DescriptionItem term="Reply tone">Warm and brief</DescriptionItem>
    </DescriptionList>
  ),
  play: ({ canvasElement }) => {
    const row = canvasElement.querySelector('dl > div')
    expect(row?.className).toContain('sm:grid-cols-[10rem_minmax(0,1fr)]')
  },
}

/** Among form fields the term sits over its value at every width, like a field's label. */
export const Stacked: Story = {
  args: { stacked: true, 'aria-label': 'Account' },
  render: (args) => (
    <DescriptionList {...args}>
      <DescriptionItem term="Email">anna@harborline.example</DescriptionItem>
      <DescriptionItem term="Address" note="From Google">
        12 Harbour Road, Varna 9000, Bulgaria
      </DescriptionItem>
    </DescriptionList>
  ),
  play: ({ canvasElement }) => {
    const row = canvasElement.querySelector('dl > div')
    expect(row?.className).not.toContain('sm:grid-cols')
    expect(within(canvasElement).getByText('Email').tagName).toBe('DT')
    expect(within(canvasElement).getByText('From Google')).toBeInTheDocument()
  },
}

export const StackedLight: Story = {
  ...Stacked,
  parameters: { theme: 'light' },
}

/** The language of a value that is not the page's is marked on the value. */
export const MarksTheLanguage: Story = {
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Добре дошли').closest('dd')).toHaveAttribute(
      'lang',
      'bg',
    )
  },
}

/** A value may be a list. */
export const ListValue: Story = {
  render: (args) => (
    <DescriptionList {...args}>
      <DescriptionItem term="Linktree">
        <ul className="space-y-1">
          <li>Menu</li>
          <li>Book a table</li>
        </ul>
      </DescriptionItem>
    </DescriptionList>
  ),
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(2)
  },
}
