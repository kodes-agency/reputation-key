// The check on return from "Open on Google", as the pane runs it: the real hook
// over a fake page (`use-google-review-check-harness.ts`). The rules themselves
// are `google-return-watcher.test.ts`; this proves the hook wires them to the
// item the pane has open, the server call, the toasts and the unmount.

import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { RETURN_CHECK_WINDOW_MS } from './google-return-watcher'
import { MINUTE, installHookHarness, stubServer } from './use-google-review-check-harness'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

/** A Google review item that is open; `overrides` makes it another kind. */
const googleReview = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  ...makeInboxItem({ id: 'rev-1', sourceType: 'review' }),
  ...overrides,
})

describe('the check on return from Google', () => {
  const pane = installHookHarness()

  it('checks the open review when the tab is visible again, and stays quiet about no reply', async () => {
    const server = stubServer(['no_reply'])
    await pane.show(googleReview(), server.asServerFn)

    await pane.backFromGoogle()

    expect(server.fn).toHaveBeenCalledTimes(1)
    expect(server.fn).toHaveBeenCalledWith({ data: { reviewId: 'rev-1' } })
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says only that it found the reply, then does not check again', async () => {
    const server = stubServer(['reply_found'])
    await pane.show(googleReview(), server.asServerFn)

    await pane.backFromGoogle()
    expect(toast.success).toHaveBeenCalledWith(
      'Google shows your reply. Closing this item.',
    )

    await pane.passTime(30 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('checks again 2 and 10 minutes later while the item is open and the tab visible', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle()

    await pane.passTime(2 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(2)

    await pane.passTime(8 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(3)
  })

  it('does not check on a return more than 30 minutes after the click', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle(RETURN_CHECK_WINDOW_MS + MINUTE)
    expect(server.fn).not.toHaveBeenCalled()
  })

  it('runs nothing while the tab is hidden', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    pane.check().noteOpenedGoogle()
    pane.page().hide()
    await pane.passTime(20 * MINUTE)
    expect(server.fn).not.toHaveBeenCalled()
  })

  it('stops when the item closes', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle()
    expect(server.fn).toHaveBeenCalledTimes(1)

    await pane.show(googleReview({ status: 'closed' }), server.asServerFn)
    await pane.passTime(20 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('stops when the manager opens another item', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle()

    await pane.show(
      makeInboxItem({ id: 'rev-2', sourceType: 'review' }),
      server.asServerFn,
    )
    await pane.passTime(20 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('stops, and releases the page, when the pane unmounts', async () => {
    const server = stubServer([])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle()

    await pane.unmount()
    await pane.passTime(20 * MINUTE)

    expect(server.fn).toHaveBeenCalledTimes(1)
    expect(pane.page().pendingTimers()).toBe(0)
    expect(pane.page().listenerCount()).toBe(0)
  })

  it('stops when the server says the review cannot be checked, and says nothing', async () => {
    const server = stubServer(['not_checkable'])
    await pane.show(googleReview(), server.asServerFn)
    await pane.backFromGoogle()
    await pane.passTime(20 * MINUTE)
    expect(server.fn).toHaveBeenCalledTimes(1)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('does nothing for a closed item, even after a visit to Google', async () => {
    const server = stubServer([])
    await pane.show(googleReview({ status: 'closed' }), server.asServerFn)
    await pane.backFromGoogle()
    expect(server.fn).not.toHaveBeenCalled()
  })
})
