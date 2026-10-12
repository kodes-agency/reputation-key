// After a refused command, the pane shows the item as the server holds it.
//
// A reply or a handling command is refused when the pane is behind: another
// manager or another tab already moved the reply or recorded an outcome. Nothing
// polls a reply that waits for a person (`replyRefetchInterval`), so before
// this a refusal left the pane on the reply it was refused for, with the same
// buttons, and every further press was refused the same way.
//
// The client is the real command hooks (`useReplyActions`,
// `useFeedbackHandlingMutations`) and a real QueryClient with the detail, the
// list and the counts mounted as the page mounts them
// (`inbox-cache-test-harness.ts`). The server is a small model of the two
// facts a refusal turns on: where the reply is, and which command revision the
// item is on.

import { describe, expect, it, vi } from 'vitest'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingState,
  InboxItem,
  InboxItemDetailResult,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { isExpectedRefusal } from '#/shared/security/expected-refusal'
import { submitFeedbackHandlingDecision } from './feedback-handling-submit'
import { installInboxCacheHarness } from './inbox-cache-test-harness'
import { createInboxItemStatusObserver } from './inbox-item-status-observer'
import type { InboxServerFns } from './types'
import { useFeedbackHandlingMutations } from './use-feedback-handling-mutations'
import { useReplyActions, type ReplyActions } from './use-reply-actions'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; only the
  // class and its recogniser are used here.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

// The HTTP edge of the reply commands. Each test says what the server answers.
// Built before the mock is hoisted and handed to it, so the suite configures the
// functions without importing a server module (the component boundary gate
// allows a component test no such import).
const replyServer = vi.hoisted(() => ({
  draftReplyFn: vi.fn(),
  submitReplyFn: vi.fn(),
  approveReplyFn: vi.fn(),
  rejectReplyFn: vi.fn(),
  deleteReplyFn: vi.fn(),
  retryPublishFn: vi.fn(),
  checkReplyPublicationFn: vi.fn(),
  editPublishedReplyFn: vi.fn(),
  listReplyTemplatesFn: vi.fn(),
  loadReplyTemplateFn: vi.fn(),
}))
vi.mock('#/contexts/review/server/reply', () => replyServer)

type Requests = { detail: number; list: number; counts: number }

const ITEM_ID = 'item-1'
const REVIEW_ID = 'review-1'

const pane = installInboxCacheHarness()

/** Mount the three reads the page keeps on screen, counting each request. */
function mountPane(readDetail: () => InboxItemDetailResult): Requests {
  const requests: Requests = { detail: 0, list: 0, counts: 0 }
  const counted = (read: keyof Requests, answer: () => unknown) => () => {
    requests[read] += 1
    return answer()
  }
  // `staleTime: 0`, as `useInboxDetailQueries` reads the open item.
  pane.mount(inboxKeys.detail(ITEM_ID), counted('detail', readDetail), 0)
  pane.mount(
    inboxKeys.list({ queue: 'approval', sort: 'newest' }),
    counted('list', () => ({ pages: [], pageParams: [] })),
  )
  pane.mount(
    inboxKeys.countsFor(),
    counted('counts', () => ({})),
  )
  return requests
}

const cachedDetail = () => pane.detail(ITEM_ID)

describe('a refused reply command', () => {
  const item: InboxItem = {
    ...makeInboxItem({ id: ITEM_ID, sourceType: 'review' }),
    sourceId: REVIEW_ID as InboxItem['sourceId'],
  }
  const replyIn = (status: string) =>
    ({
      id: 'reply-1',
      reviewId: REVIEW_ID,
      status,
      text: 'Thank you for staying.',
    }) as unknown as NonNullable<InboxItemDetailResult['reply']>
  /** What `reviewErrorStatus` makes of `invalid_transition` (review/server/reply-read.ts). */
  const refusal = new ServerFunctionError(
    'ReviewError',
    'This reply is no longer waiting for approval.',
    'invalid_transition',
    400,
  )

  const commands: ReadonlyArray<
    Readonly<{
      name: string
      serverFn: keyof typeof replyServer
      run: (actions: ReplyActions) => Promise<unknown>
    }>
  > = [
    { name: 'submit', serverFn: 'submitReplyFn', run: (a) => a.submitReply() },
    { name: 'approve', serverFn: 'approveReplyFn', run: (a) => a.approve() },
    { name: 'reject', serverFn: 'rejectReplyFn', run: (a) => a.reject('Too informal') },
    { name: 'delete', serverFn: 'deleteReplyFn', run: (a) => a.deleteDraft() },
    { name: 'retry', serverFn: 'retryPublishFn', run: (a) => a.retry() },
    { name: 'edit', serverFn: 'editPublishedReplyFn', run: (a) => a.saveEdit('Thanks!') },
  ]

  it.each(commands)(
    '$name re-reads the reply, the lists and the counts',
    async ({ serverFn, run }) => {
      // The pane opened the reply while it waited for approval…
      const server = { reply: replyIn('pending_approval') }
      const requests = mountPane(
        () => ({ item, reply: server.reply }) as InboxItemDetailResult,
      )
      await pane.settle()
      const actions = pane.renderHooks(() =>
        useReplyActions({ reviewId: REVIEW_ID, onReplyChanged: () => {} }),
      )
      // …and a colleague rejected it from another browser. Nothing tells this pane.
      server.reply = replyIn('rejected')
      replyServer[serverFn].mockRejectedValue(refusal)

      const outcome: unknown = await run(actions).catch((error: unknown) => error)
      await pane.settle()

      expect(outcome).toBe(refusal)
      expect(cachedDetail()?.reply?.status).toBe('rejected')
      expect(requests).toEqual({ detail: 2, list: 2, counts: 2 })
    },
  )

  it('a failed draft autosave re-reads nothing', async () => {
    // Autosave runs on every pause in typing, fails for want of a network far
    // more often than for a stale pane, and reports its own state in the
    // composer: it stays out of the re-read.
    const requests = mountPane(
      () => ({ item, reply: replyIn('draft') }) as InboxItemDetailResult,
    )
    await pane.settle()
    const actions = pane.renderHooks(() =>
      useReplyActions({ reviewId: REVIEW_ID, onReplyChanged: () => {} }),
    )
    const offline = new TypeError('Failed to fetch')
    replyServer.draftReplyFn.mockRejectedValue(offline)

    const outcome: unknown = await actions
      .saveDraft('Thank you for')
      .catch((error: unknown) => error)
    await pane.settle()

    expect(outcome).toBe(offline)
    expect(requests).toEqual({ detail: 1, list: 1, counts: 1 })
  })
})

describe('a refused feedback-handling command', () => {
  const open = makeInboxItem({ id: ITEM_ID, sourceType: 'feedback' })
  const handling = (status: 'open' | 'closed') =>
    ({
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: status === 'open' ? 1 : 2,
      status,
      currentOutcome: null,
      history: [],
    }) as unknown as FeedbackHandlingState

  /** The item's fence on the server, and the command that checks it. */
  function feedbackServer(initialRevision: number) {
    const state = { revision: initialRevision, status: 'open' as 'open' | 'closed' }
    const readDetail = () =>
      ({
        item: { ...open, commandRevision: state.revision, status: state.status },
        reply: null,
        feedbackHandling: handling(state.status),
      }) as InboxItemDetailResult
    const markFeedbackHandled = async (input: {
      data: { expectedCommandRevision: number }
    }): Promise<FeedbackHandlingCommandResult | InboxRevisionConflictResult> => {
      if (input.data.expectedCommandRevision !== state.revision) {
        // `toInboxRevisionConflictResult`, as `inbox-feedback-handling.ts` returns it.
        return {
          ok: false,
          code: 'revision_conflict',
          currentCommandRevision: state.revision,
          currentStatus: state.status,
        }
      }
      state.revision += 1
      state.status = 'closed'
      const handled = readDetail()
      return {
        item: handled.item,
        feedbackHandling: handled.feedbackHandling,
      } as FeedbackHandlingCommandResult
    }
    return { state, readDetail, markFeedbackHandled }
  }

  function renderHandling(server: ReturnType<typeof feedbackServer>) {
    return pane.renderHooks(() =>
      useFeedbackHandlingMutations(
        {
          markFeedbackHandled:
            server.markFeedbackHandled as unknown as InboxServerFns['markFeedbackHandled'],
          correctFeedbackHandlingOutcome:
            server.markFeedbackHandled as unknown as InboxServerFns['correctFeedbackHandlingOutcome'],
        },
        pane.client,
        createInboxItemStatusObserver(),
      ),
    )
  }

  /** The dialog's submit, built from what the pane shows at that moment. */
  const markAsHandled = (mutations: ReturnType<typeof renderHandling>) => {
    const detail = cachedDetail()!
    return submitFeedbackHandlingDecision({
      mode: 'mark',
      item: detail.item,
      state: detail.feedbackHandling!,
      decision: { outcome: 'follow_up_completed', internalNote: null },
      markFeedbackHandled: mutations.markFeedbackHandled,
      correctFeedbackHandlingOutcome: mutations.correctFeedbackHandlingOutcome,
    })
  }

  it('re-reads the item, so the next attempt carries its current revision', async () => {
    const server = feedbackServer(3)
    const requests = mountPane(server.readDetail)
    await pane.settle()
    const mutations = renderHandling(server)
    // A colleague added a note from another browser: the item is one further on.
    server.state.revision = 4

    const refused: unknown = await markAsHandled(mutations).catch(
      (error: unknown) => error,
    )
    await pane.settle()

    expect(refused).toMatchObject({
      code: 'revision_conflict',
      currentCommandRevision: 4,
    })
    expect(cachedDetail()?.item.commandRevision).toBe(4)
    expect(requests).toEqual({ detail: 2, list: 2, counts: 2 })

    await markAsHandled(mutations)

    expect(server.state).toEqual({ revision: 5, status: 'closed' })
    expect(cachedDetail()?.item).toMatchObject({ commandRevision: 5, status: 'closed' })
  })

  it('says the conflict in its own words, as a refusal and not a failure', async () => {
    const server = feedbackServer(3)
    mountPane(server.readDetail)
    await pane.settle()
    const mutations = renderHandling(server)
    server.state.revision = 4

    const refused: unknown = await markAsHandled(mutations).catch(
      (error: unknown) => error,
    )

    // What the dialog's banner prints (`FormErrorBanner` uses this rule).
    expect(actionErrorMessage(refused)).toBe(
      'This item changed while you were working. Check it and try again.',
    )
    // A refusal the browser SDK drops rather than reports.
    expect(isExpectedRefusal(refused)).toBe(true)
  })
})
