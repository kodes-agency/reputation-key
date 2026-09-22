// The bell popover's body is a lazy chunk; a failed load of it must stay in
// the popover, not take the app shell down to the route error page.
import { Suspense } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { lazyPopoverBody, PopoverBodyUnavailable } from './notification-popover-loader'

/** What a tab left open across a deploy gets for the body's old chunk name. */
const MissingChunk = lazyPopoverBody<object>(() =>
  Promise.reject(
    new TypeError('Failed to fetch dynamically imported module: /assets/stale.js'),
  ),
)

const onReload = fn()

const meta: Meta<typeof PopoverBodyUnavailable> = {
  title: 'Notification/NotificationPopoverLoader',
  component: PopoverBodyUnavailable,
  parameters: { layout: 'centered' },
  args: { onReload },
  decorators: [
    (Story) => (
      <div className="w-96 rounded-xl border bg-popover text-popover-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PopoverBodyUnavailable>

/** The failure stays in the popover: the page around it keeps rendering. */
export const BodyChunkFailed: Story = {
  render: () => (
    <>
      <p>Page content outside the popover</p>
      <Suspense fallback={<span>Loading notifications…</span>}>
        <MissingChunk />
      </Suspense>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('alert')).toHaveTextContent(
      "Couldn't load notifications.",
    )
    expect(canvas.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(canvas.getByText('Page content outside the popover')).toBeInTheDocument()
  },
}

/** Only a fresh page gets the new build's chunks, so the way back is a reload. */
export const ReloadsThePage: Story = {
  play: async ({ canvasElement }) => {
    onReload.mockClear()
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Reload page' }),
    )
    expect(onReload).toHaveBeenCalledTimes(1)
  },
}
