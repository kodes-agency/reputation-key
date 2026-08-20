// The densest visual surface in the app, and until now it had zero stories.
//
// Every fixture comes from the one shared factory (notification-fixtures.ts),
// which returns a COMPLETE `Notification` — the old per-story helpers cast an
// incomplete object to `Notification` and would have rendered `undefined` once
// the row started reading `payload`.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  longPropertyNameNotification,
  makeNotification,
  notificationFixtures,
} from './notification-fixtures'
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

const [escalated, pendingApproval, newReview, noMetadata, badge] = notificationFixtures

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

export const Read: Story = {
  args: { notification: badge },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Unread.')).not.toBeInTheDocument()
    expect(canvas.getByText(/Response Champ/)).toBeInTheDocument()
  },
}

export const HighRating: Story = {
  args: { notification: newReview },
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
      payload: { propertyName: 'Riverside Hotel', rating: 4 },
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

/** Safe secondary actions only — no inline Approve/Publish. */
export const OverflowMenu: Story = {
  args: { notification: newReview },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^More actions for:/ }))
    // Radix portals the menu outside the story canvas.
    const menu = within(document.body)
    expect(await menu.findByRole('menuitem', { name: 'Mark as read' })).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: /^Mute/ })).toBeInTheDocument()
    expect(menu.queryByRole('menuitem', { name: /approve|publish/i })).toBeNull()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Mark as read' }))
    expect(actions.onMarkRead).toHaveBeenCalledWith(newReview.id)
  },
}
