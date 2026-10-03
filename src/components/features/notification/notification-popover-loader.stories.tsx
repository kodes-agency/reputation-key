// The bell popover's body is a lazy chunk; a failed load of it must stay in
// the popover, not take the app shell down to the route error page.
import { Suspense } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Sheet, SheetContent } from '#/components/ui/sheet'
import { lazyPopoverBody, PopoverBodyUnavailable } from './notification-popover-loader'
import { NotificationSheetHeader } from './notification-sheet-header'

/** What a tab left open across a deploy gets for the body's old chunk name. */
const MissingChunk = lazyPopoverBody<object>(() =>
  Promise.reject(
    new TypeError('Failed to fetch dynamically imported module: /assets/stale.js'),
  ),
)

/** The same stale chunk, asked for by the phone sheet, which passes its Close. */
const MissingSheetChunk = lazyPopoverBody<Readonly<{ onClose: () => void }>>(() =>
  Promise.reject(
    new TypeError('Failed to fetch dynamically imported module: /assets/stale.js'),
  ),
)

const onReload = fn()
const onClose = fn()

const meta: Meta<typeof PopoverBodyUnavailable> = {
  title: 'Notification/NotificationPopoverLoader',
  component: PopoverBodyUnavailable,
  parameters: { layout: 'centered' },
  args: { onReload },
  decorators: [
    (Story) => (
      <div className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover text-popover-foreground">
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
      'Notifications couldn’t be loaded.',
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

/**
 * On a phone the bell is a full-screen sheet with no outside to tap (D8). A
 * failed body keeps the sheet's name and its Close, and so does the stand-in
 * shown while the chunk is still on its way.
 */
export const InTheSheetKeepsItsNameAndClose: Story = {
  render: () => (
    <Sheet open modal={false}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        aria-label="Notifications"
      >
        <Suspense fallback={<NotificationSheetHeader onClose={onClose} />}>
          <MissingSheetChunk onClose={onClose} />
        </Suspense>
      </SheetContent>
    </Sheet>
  ),
  play: async () => {
    onClose.mockClear()
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Notifications' }),
    )
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Notifications couldn’t be loaded.',
    )
    expect(dialog.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Close notifications' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  },
}
