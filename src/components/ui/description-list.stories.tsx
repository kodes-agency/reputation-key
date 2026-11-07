// Read-only label/value rows, with the term above its value on a phone and a
// separate column on wider screens. Both themes use the app's CSS.
import { playInThemes } from '../../../.storybook/play-in-themes'
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
  play: playInThemes(({ canvasElement }) => {
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
  }),
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
    const term = within(canvasElement)
      .getByText('Responsible manager')
      .getBoundingClientRect()
    const value = within(canvasElement).getByText('Anna Petrova').getBoundingClientRect()
    if (window.innerWidth >= 640) {
      expect(term.width).toBe(160)
      expect(value.left).toBeGreaterThanOrEqual(term.right)
      expect(value.top).toBe(term.top)
    } else {
      expect(value.top).toBeGreaterThanOrEqual(term.bottom)
    }
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
  play: playInThemes(({ canvasElement }) => {
    const term = within(canvasElement).getByText('Email').getBoundingClientRect()
    const value = within(canvasElement)
      .getByText('anna@harborline.example')
      .getBoundingClientRect()
    expect(value.top).toBeGreaterThanOrEqual(term.bottom)
    expect(value.left).toBe(term.left)
    expect(within(canvasElement).getByText('Email').tagName).toBe('DT')
    expect(within(canvasElement).getByText('From Google')).toBeInTheDocument()
  }),
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
