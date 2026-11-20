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
  // A shared view offers every filter; the stories at the end choose a queue that offers fewer.
  args: { queue: 'open', value: emptyFilters, onChange: fn() },
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

export const AspectAndPolarity: Story = {
  args: {
    value: {
      ...emptyFilters,
      aspect: 'wait_time',
      polarity: 'negative',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /filters/i }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('combobox', { name: 'Aspect' })).toHaveTextContent(
      'Wait time',
    )
    await expect(body.getByRole('combobox', { name: 'Polarity' })).toHaveTextContent(
      'Complaints',
    )
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

/** Opens the popover and says which filters it offers and which it leaves out. */
async function expectOffered(
  canvasElement: HTMLElement,
  offered: ReadonlyArray<string>,
  leftOut: ReadonlyArray<string>,
) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /filters/i }))
  const body = within(canvasElement.ownerDocument.body)
  for (const name of offered) {
    await expect(body.getByRole('combobox', { name })).toBeVisible()
  }
  for (const name of leftOut) {
    await expect(body.queryByRole('combobox', { name })).toBeNull()
  }
}

export const SectionQueueHasNoSource: Story = {
  args: { queue: 'reply' },
  play: ({ canvasElement }) =>
    expectOffered(
      canvasElement,
      ['Priority', 'Aspect', 'Polarity', 'Rating'],
      ['Source'],
    ),
}

/**
 * Priority matches a level a manager sets on feedback too (ADR 0071); the
 * topics read an analysis feedback lacks.
 */
export const PrivateFeedbackOffersPriorityAndRating: Story = {
  args: { queue: 'feedback' },
  play: ({ canvasElement }) =>
    expectOffered(
      canvasElement,
      ['Priority', 'Rating'],
      ['Source', 'Aspect', 'Polarity'],
    ),
}
