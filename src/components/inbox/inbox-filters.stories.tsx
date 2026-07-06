// Inbox filters bar — controlled status/source/platform/rating controls.
// Pure presentational component (no hooks beyond useCallback); stories cover the
// filter states via the controlled `value` prop and a `play` that asserts the
// onChange channel fires when the rating input changes.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { InboxFilters, type InboxFilterValues } from './inbox-filters'

const properties = [
  { id: 'prop-1', name: 'Acme Hotel' },
  { id: 'prop-2', name: 'Beachside Resort' },
  { id: 'prop-3', name: 'Mountain Lodge' },
]

const emptyFilters: InboxFilterValues = {
  propertyId: undefined,
  status: undefined,
  sourceType: undefined,
  platform: undefined,
  ratingMin: undefined,
  ratingMax: undefined,
  q: undefined,
}

const meta: Meta<typeof InboxFilters> = {
  title: 'Inbox/Filters',
  component: InboxFilters,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxFilters>

// No filters applied — every select shows its "All …" placeholder.
export const Default: Story = {
  args: { value: emptyFilters, onChange: fn(), properties },
}

// Status filter set → the status trigger reflects the active selection.
export const StatusEscalated: Story = {
  args: { value: { ...emptyFilters, status: 'escalated' }, onChange: fn(), properties },
}

// Source + platform filtered, scoped to one property.
export const ReviewOnGoogle: Story = {
  args: {
    value: {
      ...emptyFilters,
      propertyId: 'prop-1',
      sourceType: 'review',
      platform: 'google',
    },
    onChange: fn(),
    properties,
  },
}

// Rating range narrowed to 4–5 stars.
export const RatingRange: Story = {
  args: {
    value: { ...emptyFilters, ratingMin: 4, ratingMax: 5 },
    onChange: fn(),
    properties,
  },
}

// Everything filtered at once — the densest filter row.
export const FullyFiltered: Story = {
  args: {
    value: {
      ...emptyFilters,
      propertyId: 'prop-1',
      status: 'new',
      sourceType: 'review',
      platform: 'google',
      ratingMin: 3,
      ratingMax: 5,
    },
    onChange: fn(),
    properties,
  },
}

// Typing into the min-rating input pushes ratingMin through onChange.
export const ChangeRatingMin: Story = {
  args: { value: emptyFilters, onChange: fn(), properties },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const minInput = canvas.getByPlaceholderText('Min ★')
    await userEvent.type(minInput, '3')
    await waitFor(() => {
      expect(args.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ ratingMin: 3 }),
      )
    })
  },
}
