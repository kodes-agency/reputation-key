// The list header's search row. On a phone it replaces the whole header bar, so
// the match count and the close button have to earn their room.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { InboxListSearch } from './inbox-list-search'

const onChange = fn()
const onClose = fn()

const meta: Meta<typeof InboxListSearch> = {
  title: 'Inbox/List Search',
  component: InboxListSearch,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex w-[360px] items-center border px-4">
        <Story />
      </div>
    ),
  ],
  args: { value: undefined, totalCount: 292, onChange, onClose },
  beforeEach: () => {
    onChange.mockClear()
    onClose.mockClear()
  },
}
export default meta
type Story = StoryObj<typeof InboxListSearch>

// Nothing typed yet: the total is every review in the queue, not a match count.
export const BeforeTyping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Search reviews' })).toHaveFocus()
    expect(canvas.queryByText(/matches/)).toBeNull()
  },
}

export const WithQuery: Story = {
  args: { value: 'breakfast', totalCount: 7 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Search reviews' })).toHaveValue(
      'breakfast',
    )
    expect(canvas.getByText('7 matches')).toBeVisible()
  },
}

export const TypingReportsTheQuery: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Search reviews' }), 'b')
    expect(onChange).toHaveBeenCalledWith('b')
  },
}

export const CloseClearsTheQuery: Story = {
  args: { value: 'breakfast', totalCount: 7 },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Close search' }),
    )
    expect(onChange).toHaveBeenCalledWith(undefined)
    expect(onClose).toHaveBeenCalledTimes(1)
  },
}

// 390 px: the same row, for the metrics gate to measure the 36px close button.
// Fullscreen, because a centered story pads the 360px frame past the window.
export const Phone: Story = {
  args: { value: 'breakfast', totalCount: 7 },
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('7 matches')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Close search' })).toBeVisible()
  },
}
