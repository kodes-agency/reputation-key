// The densest visual surface in the app, and until now it had zero stories.
//
// Every fixture comes from the one story/test-only factory,
// which returns a COMPLETE `Notification` — the old per-story helpers cast an
// incomplete object to `Notification` and would have rendered `undefined` once
// the row started reading `payload`.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  longPropertyNameNotification,
  makeNotification,
  notificationFixtures,
} from './notification.stories.fixtures'
import { NotificationRow } from './notification-row'
import type { NotificationRowActions } from './types'

const actions: NotificationRowActions = {
  onActivate: fn(),
  onMarkRead: fn(),
  onMarkUnread: fn(),
  onDismiss: fn(),
  onMuteCategory: fn(),
}

const meta: Meta<typeof NotificationRow> = {
  title: 'Notification/NotificationRow',
  component: NotificationRow,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { actions },
  decorators: [
    (Story) => (
      // The row IS an <li>; a bare <li> outside a list is an axe violation.
      <ul className="w-[26rem] rounded-xl border bg-popover p-1 text-popover-foreground">
        <Story />
      </ul>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationRow>

const [escalated, pendingApproval, newFeedback, noMetadata] = notificationFixtures

const muteableReview = makeNotification({
  id: '20000000-0000-4000-8000-000000000002',
  type: 'review.created',
  status: 'unread',
  payload: { propertyName: 'Harbour View Suites', platform: 'google' },
})

/** Urgent + unread: pill, unread dot, rating glyphs, waiting age, accent CTA. */
export const UrgentUnread: Story = {
  args: { notification: escalated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Copy comes from renderNotification, never from the stored snapshot.
    expect(canvas.queryByText(/LEGACY SNAPSHOT/i)).not.toBeInTheDocument()
    // The whole point: no identifier on screen. The id lives in the href only.
    expect(canvasElement.textContent).not.toContain(escalated.resourceId)
    expect(canvasElement.textContent).not.toContain(escalated.id)
    expect(canvas.getByText('Urgent')).toBeInTheDocument()
    // The property name appears twice by design — in the rendered sentence and
    // in the metadata chip — so this asserts presence, not uniqueness.
    expect(canvas.getAllByText(/Riverside Hotel/).length).toBeGreaterThan(0)
    // Rating is never glyph-or-colour alone.
    expect(canvas.getByText('Rated 2 out of 5 stars')).toBeInTheDocument()
    // 26 waiting hours renders as the compact "1d" the domain formats.
    expect(canvas.getAllByText(/Waiting 1d/).length).toBeGreaterThan(0)
    // The deep link carries the resource id as a typed search param.
    const cta = canvas.getByRole('link')
    expect(cta).toHaveAttribute('href', expect.stringContaining(escalated.resourceId))
  },
}

/** ADR 0046 r.2 coalescing: one unread row absorbing repeat events. */
export const Coalesced: Story = {
  args: { notification: pendingApproval },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Updated 3 times')).toBeInTheDocument()
  },
}

export const HighRating: Story = {
  args: { notification: newFeedback },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Rated 5 out of 5 stars')).toBeInTheDocument()
  },
}

/** Empty payload: the sentence must shorten, never print "undefined". */
export const NoMetadata: Story = {
  args: { notification: noMetadata },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.textContent).not.toContain('undefined')
    expect(canvas.queryByText(/Waiting/)).not.toBeInTheDocument()
    // A CTA is still offered — an unlabelled row would be a dead end.
    expect(canvas.getByRole('link')).toBeInTheDocument()
  },
}

export const LongPropertyName: Story = {
  args: { notification: longPropertyNameNotification },
  play: async ({ canvasElement }) => {
    // The invariant that matters: the chip truncates within the row rather than
    // widening it. An inline `.truncate` span reports clientWidth 0, so the
    // chip's own box is measured against its list container.
    const list = canvasElement.querySelector('ul')
    const chip = canvasElement.querySelector('[data-slot="badge"]')
    expect(list).not.toBeNull()
    expect(chip).not.toBeNull()
    if (list === null || chip === null) return
    expect(chip.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(chip.getBoundingClientRect().width).toBeLessThanOrEqual(
      list.getBoundingClientRect().width,
    )
  },
}

/**
 * The regression this story pins: dismiss used to be `text-muted-foreground/0`
 * revealed only by `group-hover:`, with no `focus-visible:` rule, so a keyboard
 * user tabbed onto an invisible control.
 */
export const DismissIsKeyboardReachable: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000001',
      payload: { propertyName: 'Riverside Hotel' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dismiss = canvas.getByRole('button', { name: /^Dismiss:/ })
    dismiss.focus()
    expect(dismiss).toHaveFocus()
    expect(dismiss).toBeVisible()
    await userEvent.keyboard('{Enter}')
    expect(actions.onDismiss).toHaveBeenCalled()
  },
}

/**
 * Safe secondary actions only — no inline Approve/Publish — and selecting one
 * reports it.
 *
 * The story deliberately ends with the menu CLOSED AND SETTLED. Radix's
 * DropdownMenu is modal: while open it puts `aria-hidden` on everything outside
 * its portal, which includes `#storybook-root` — the element the a11y addon
 * audits, and which still holds the row's focusable controls. Yielding while
 * that is true makes axe report `aria-hidden-focus` about Radix's overlay
 * strategy rather than about this row. Radix also clears those attributes
 * asynchronously, and the runner's axe pass fires the instant `play` resolves,
 * so the wait below is load-bearing, not cosmetic.
 */
export const OverflowMenu: Story = {
  // A routine Review update belongs to the configurable collaboration
  // category. Private feedback is Action Required and is covered separately
  // by ActionNeededCannotBeMuted below.
  args: { notification: muteableReview },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ownerDocument = canvasElement.ownerDocument
    await userEvent.click(canvas.getByRole('button', { name: /^More actions for:/ }))
    // Radix portals the menu outside the story canvas.
    const menu = within(ownerDocument.body)
    expect(
      await menu.findByRole('menuitem', { name: 'Mark as read' }),
    ).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: /^Mute/ })).toBeInTheDocument()
    // The deliberate omission: approving or publishing a reply must not be one
    // click away from a notification the reader has not opened.
    expect(menu.queryByRole('menuitem', { name: /approve|publish/i })).toBeNull()

    await userEvent.click(menu.getByRole('menuitem', { name: 'Mark as read' }))
    expect(actions.onMarkRead).toHaveBeenCalledWith(muteableReview.id)

    await waitFor(() => {
      expect(ownerDocument.querySelector('[role="menu"]')).toBeNull()
      expect(canvasElement).not.toHaveAttribute('aria-hidden')
      expect(canvasElement).not.toHaveAttribute('data-aria-hidden')
      expect(ownerDocument.body.style.pointerEvents).toBe('')
    })
  },
}

/** Action-needed rows stay in-app and therefore never offer a mute action. */
export const ActionNeededCannotBeMuted: Story = {
  args: { notification: escalated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ownerDocument = canvasElement.ownerDocument
    await userEvent.click(canvas.getByRole('button', { name: /^More actions for:/ }))
    const menu = within(ownerDocument.body)
    const markAsRead = await menu.findByRole('menuitem', { name: 'Mark as read' })
    await waitFor(() => expect(markAsRead).toBeVisible())
    expect(menu.queryByRole('menuitem', { name: /^Mute/ })).toBeNull()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Mark as read' }))
    await waitFor(() => expect(ownerDocument.querySelector('[role="menu"]')).toBeNull())
  },
}
