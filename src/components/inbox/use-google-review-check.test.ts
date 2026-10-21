// "Check on Google" as the Inbox pane offers it: which items get the action,
// and what the manager's own check says. The check on return from Google is
// `use-google-return-check.test.ts`; both mount the real hook
// (`use-google-review-check-harness.ts`).

import { act } from 'react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import type {
  InboxGoogleCheckOutcome,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { InboxServerFns } from './types'
import { IDLE, installHookHarness, stubServer } from './use-google-review-check-harness'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const UNAVAILABLE = "Couldn't check Google right now. Try again in a minute."

/** A Google review item that is open; `overrides` makes it another kind. */
const googleReview = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  ...makeInboxItem({ id: 'rev-1', sourceType: 'review' }),
  ...overrides,
})

describe('useGoogleReviewCheck', () => {
  const pane = installHookHarness()

  const checkNow = () =>
    act(async () => {
      await pane.check().check()
    })

  describe('whether the action is offered', () => {
    it('is offered for a Google review item', async () => {
      await pane.show(googleReview(), stubServer([]).asServerFn)
      expect(pane.check().available).toBe(true)
    })

    it.each([
      ['a feedback item', makeInboxItem({ id: 'fb-1', sourceType: 'feedback' })],
      ['a review from another platform', googleReview({ platform: 'tripadvisor' })],
      ['a review with no platform', googleReview({ platform: null })],
    ])('is not offered for %s', async (_label, item) => {
      await pane.show(item, stubServer([]).asServerFn)
      expect(pane.check().available).toBe(false)
    })

    it('is not offered where the server cannot check, or with no item open', async () => {
      await pane.show(googleReview(), undefined)
      expect(pane.check().available).toBe(false)
      await pane.show(null, stubServer([]).asServerFn)
      expect(pane.check().available).toBe(false)
    })

    it('stops being offered for a review the server says cannot be checked', async () => {
      await pane.show(googleReview(), stubServer(['not_checkable']).asServerFn)
      await checkNow()
      expect(pane.check().available).toBe(false)
    })
  })

  describe('the manager’s own check', () => {
    it('asks the server about the open review and says a found reply in a toast', async () => {
      const server = stubServer(['reply_found'])
      await pane.show(googleReview(), server.asServerFn)

      await checkNow()

      expect(server.fn).toHaveBeenCalledWith({ data: { reviewId: 'rev-1' } })
      expect(toast.success).toHaveBeenCalledWith(
        'Google shows a reply. Closing this item.',
      )
    })

    it('does not say it is closing an item that is already closed', async () => {
      await pane.show(
        googleReview({ status: 'closed' }),
        stubServer(['reply_found']).asServerFn,
      )

      await checkNow()

      expect(toast.success).toHaveBeenCalledWith('Google shows a reply.')
    })

    it('says when Google shows no reply yet', async () => {
      await pane.show(googleReview(), stubServer(['no_reply']).asServerFn)
      await checkNow()
      expect(toast.info).toHaveBeenCalledWith('Google shows no reply yet.')
    })

    it.each(['unavailable', 'rate_limited'] as const)(
      'says to try again in a minute when the answer is %s',
      async (outcome) => {
        await pane.show(googleReview(), stubServer([outcome]).asServerFn)
        await checkNow()
        const said = [
          ...vi.mocked(toast.error).mock.calls,
          ...vi.mocked(toast.info).mock.calls,
        ].map(([message]) => message)
        expect(said).toEqual([UNAVAILABLE])
      },
    )

    it('says it could not check, in the same words, when the call itself fails', async () => {
      await pane.show(googleReview(), stubServer([new Error('network')]).asServerFn)
      await checkNow()
      expect(toast.error).toHaveBeenCalledWith(UNAVAILABLE)
    })

    it('shows the server’s own sentence for a refusal', async () => {
      const refusal = new ServerFunctionError(
        'InboxError',
        'No access to this inbox source',
        'forbidden',
        403,
      )
      await pane.show(googleReview(), stubServer([refusal]).asServerFn)
      await checkNow()
      expect(toast.error).toHaveBeenCalledWith('No access to this inbox source')
    })

    it('re-reads the item once the reply is found, so the close shows', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const reads = vi.spyOn(pane.client(), 'invalidateQueries')
        await pane.show(googleReview(), stubServer(['reply_found']).asServerFn)
        await checkNow()
        await vi.advanceTimersByTimeAsync(10_000)
        expect(reads).toHaveBeenCalledWith({
          queryKey: inboxKeys.detail('rev-1'),
          exact: true,
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('runs one check at a time: a second click while one is running is not another read', async () => {
      let release: (() => void) | undefined
      const fn = vi.fn(
        () =>
          new Promise<{ outcome: InboxGoogleCheckOutcome }>((resolve) => {
            release = () => resolve({ outcome: 'no_reply' })
          }),
      )
      await pane.show(
        googleReview(),
        fn as unknown as InboxServerFns['checkReviewOnGoogle'],
      )

      await act(async () => {
        void pane.check().check()
        void pane.check().check()
      })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(pane.check().isChecking).toBe(true)

      await act(async () => {
        release?.()
      })
      await IDLE()
      expect(pane.check().isChecking).toBe(false)
    })
  })
})
