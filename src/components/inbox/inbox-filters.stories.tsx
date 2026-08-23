import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { InboxFilterPopover } from './inbox-filter-popover'
import { CLEARED_INBOX_LIST_FILTERS, type InboxListFilterValues } from './inbox-filters'

const emptyFilters: InboxListFilterValues = CLEARED_INBOX_LIST_FILTERS

const meta = {
  title: 'Inbox/Filter Popover',
  component: InboxFilterPopover,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { value: emptyFilters, onChange: fn() },
} satisfies Meta<typeof InboxFilterPopover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ActiveFilters: Story = {
  args: {
    value: {
      ...emptyFilters,
      sourceType: 'review',
      ratingMin: 4,
      attention: 'urgent',
    },
  },
}

export const ClearFilters: Story = {
  args: {
    value: { ...emptyFilters, sourceType: 'review', ratingMax: 3 },
    onChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /filters/i }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: /clear/i }))
    expect(args.onChange).toHaveBeenCalledWith(CLEARED_INBOX_LIST_FILTERS)
  },
}

export const ChangeRating: Story = {
  args: { onChange: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /filters/i }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('combobox', { name: 'Rating' }))
    await userEvent.click(body.getByRole('option', { name: '3 stars and below' }))
    expect(args.onChange).toHaveBeenCalledWith({
      ratingMin: undefined,
      ratingMax: 3,
    })
  },
}
