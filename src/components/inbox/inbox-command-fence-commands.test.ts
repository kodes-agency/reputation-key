// Every single-item command leaves the item's row, in every cached list, on
// the command revision it returned.
//
// The companion of `inbox-command-fence.test.ts` (the note), for the commands
// that return an item snapshot. Their result was written into the detail, and
// the row followed only when a list re-read landed: a correction re-reads no
// list at all, and the status commands re-read only the list on screen.
//
// A list that is cached but not on screen is marked stale and re-read when it
// is shown again; until that read lands its rows are what a bulk command would
// send. So the row is checked there, where no re-read can have brought the
// revision forward.

import { describe, expect, it, vi } from 'vitest'
import {
  createInboxContainer,
  makeInboxItem,
} from '../../../.storybook/in-memory/inbox-container'
import { makeInboxFns } from '../../../.storybook/in-memory/inbox-fns'
import type { FeedbackHandlingCommandResult } from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { installInboxCacheHarness, type ListFilters } from './inbox-cache-test-harness'
import { createInboxItemStatusObserver } from './inbox-item-status-observer'
import type { InboxServerFns } from './types'
import { useFeedbackHandlingMutations } from './use-feedback-handling-mutations'
import { useInboxDetail, type InboxDetailState } from './use-inbox-detail'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; only its
  // recogniser is used here.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const COLLEAGUE = 'user-00000000-0000-0000-0000-000000000002'
const OPENED_EARLIER: ListFilters = { queue: 'open', sort: 'newest' }

const pane = installInboxCacheHarness()

/**
 * The Storybook in-memory container as the server: the real Inbox use cases
 * (note, escalate, assign, bulk assign, list, detail) over in-memory
 * repositories, behind the same server-function bundle a route passes down.
 * Three open reviews, each on command revision 1.
 */
function seededInboxServer(): InboxServerFns {
  const container = createInboxContainer()
  container.seed(
    ['item-x', 'item-y', 'item-z'].map((id) =>
      makeInboxItem({ id, sourceType: 'review' }),
    ),
  )
  return makeInboxFns(container)
}

describe('a command issued from the open item', () => {
  it.each([
    {
      command: 'escalate',
      run: (detail: InboxDetailState) =>
        detail.escalate({ data: { inboxItemId: 'item-x', expectedCommandRevision: 1 } }),
    },
    {
      command: 'assign',
      run: (detail: InboxDetailState) =>
        detail.assign({
          data: {
            inboxItemId: 'item-x',
            assignedToUserId: COLLEAGUE,
            expectedCommandRevision: 1,
          },
        }),
    },
  ])('$command leaves a cached row on the revision it returned', async ({ run }) => {
    const fns = seededInboxServer()
    await pane.cacheList(fns, OPENED_EARLIER)
    pane.openItem(fns, 'item-x')
    await pane.settle()
    const detail = pane.renderHooks(() =>
      useInboxDetail(pane.detail('item-x')?.item ?? null, true, fns, {
        selectedItemId: 'item-x',
      }),
    )

    const updated = await run(detail)

    expect(updated.commandRevision).toBe(2)
    expect({
      detail: pane.detail('item-x')?.item.commandRevision,
      row: pane.rowRevision(OPENED_EARLIER, 'item-x'),
    }).toEqual({ detail: 2, row: 2 })
  })

  it('a corrected handling outcome leaves the row on the revision it returned', async () => {
    // A correction does not move the item between folders, so no list is
    // re-read for it: the write-through is the only thing that reaches the row.
    const row = {
      ...makeInboxItem({ id: 'item-f', sourceType: 'feedback', status: 'closed' }),
      commandRevision: 4,
    }
    pane.client.setQueryData(inboxKeys.detail('item-f'), { item: row, reply: null })
    pane.client.setQueryData(inboxKeys.list(OPENED_EARLIER), {
      pages: [{ items: [row], nextCursor: null }],
      pageParams: [undefined],
    })
    const corrected = {
      item: { ...row, commandRevision: 5 },
      feedbackHandling: null,
    } as unknown as FeedbackHandlingCommandResult
    const answer = async () => corrected
    const { correctFeedbackHandlingOutcome } = pane.renderHooks(() =>
      useFeedbackHandlingMutations(
        {
          markFeedbackHandled: answer as unknown as InboxServerFns['markFeedbackHandled'],
          correctFeedbackHandlingOutcome:
            answer as unknown as InboxServerFns['correctFeedbackHandlingOutcome'],
        },
        pane.client,
        createInboxItemStatusObserver(),
      ),
    )

    await correctFeedbackHandlingOutcome({
      data: {
        inboxItemId: 'item-f',
        expectedCommandRevision: 4,
        expectedCycleNumber: 1,
        expectedSourceRevision: 1,
        expectedStateRevision: 2,
        expectedOutcomeId: '11111111-1111-4111-8111-111111111111',
        expectedOutcomeRevision: 1,
        outcome: 'follow_up_completed',
        internalNote: null,
      },
    })

    expect({
      detail: pane.detail('item-f')?.item.commandRevision,
      row: pane.rowRevision(OPENED_EARLIER, 'item-f'),
    }).toEqual({ detail: 5, row: 5 })
  })
})
