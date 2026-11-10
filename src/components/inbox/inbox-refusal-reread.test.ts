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

import { toast } from 'sonner'
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
import { submitFeedbackHandlingDecision } from '../../contexts/reputation/inbox/ui/feedback-handling-submit'
import { installInboxCacheHarness } from './inbox-cache-test-harness'
import { createInboxItemStatusObserver } from '../../contexts/reputation/inbox/ui/inbox-item-status-observer'
import type { InboxServerFns } from './types'
import { useFeedbackHandlingMutations } from '../../contexts/reputation/inbox/ui/use-feedback-handling-mutations'
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
vi.mock('#/contexts/review/server/reply-templates', () => replyServer)

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
  pane.mount({
    queryKey: inboxKeys.detail(ITEM_ID),
    queryFn: counted('detail', readDetail),
    staleTime: 0,
  })
  pane.mount({
    queryKey: inboxKeys.list({ queue: 'approval', sort: 'newest' }),
    queryFn: counted('list', () => ({ pages: [], pageParams: [] })),
  })
  pane.mount({
    queryKey: inboxKeys.countsFor(),
    queryFn: counted('counts', () => ({})),
  })
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

  /** The reply a confirmation was opened on, as the row names it to the server. */
  const OPENED_ON = { id: 'reply-1', stateRevision: 2 }

  type Command = Readonly<{
    name: string
    serverFn: keyof typeof replyServer
    run: (actions: ReplyActions) => Promise<unknown>
  }>
  /** Immediate actions: nothing but a toast can say their refusal. */
  const immediate: ReadonlyArray<Command> = [
    { name: 'submit', serverFn: 'submitReplyFn', run: (a) => a.submitReply() },
    { name: 'reject', serverFn: 'rejectReplyFn', run: (a) => a.reject('Too informal') },
    { name: 'delete', serverFn: 'deleteReplyFn', run: (a) => a.deleteDraft() },
    { name: 'retry', serverFn: 'retryPublishFn', run: (a) => a.retry() },
  ]
  /** Confirmed in a dialog, which stays open and says the refusal itself. */
  const confirmed: ReadonlyArray<Command> = [
    { name: 'approve', serverFn: 'approveReplyFn', run: (a) => a.approve(OPENED_ON) },
    { name: 'edit', serverFn: 'editPublishedReplyFn', run: (a) => a.saveEdit('Thanks!') },
  ]

  /**
   * The pane opened the reply while it waited for approval, a colleague
   * rejected it from another browser, and nothing told this pane. `run` is
   * then refused. Resolves what the caller got back and what was requested.
   */
  async function refuse({ serverFn, run }: Command) {
    const server = { reply: replyIn('pending_approval') }
    const requests = mountPane(
      () => ({ item, reply: server.reply }) as InboxItemDetailResult,
    )
    await pane.settle()
    const actions = pane.renderHooks(() =>
      useReplyActions({ reviewId: REVIEW_ID, onReplyChanged: () => {} }),
    )
    server.reply = replyIn('rejected')
    replyServer[serverFn].mockRejectedValue(refusal)

    const outcome: unknown = await run(actions).catch((error: unknown) => error)
    await pane.settle()
    return { outcome, requests }
  }

  it.each(immediate)(
    '$name says the refusal in a toast and re-reads the reply, the lists and the counts',
    async (command) => {
      const { outcome, requests } = await refuse(command)

      expect(outcome).toBe(refusal)
      expect(vi.mocked(toast.error).mock.calls).toEqual([
        ['This reply is no longer waiting for approval.'],
      ])
      expect(cachedDetail()?.reply?.status).toBe('rejected')
      expect(requests).toEqual({ detail: 2, list: 2, counts: 2 })
    },
  )

  // One reporter: the dialog prints the rejection it is handed, so a toast as
  // well would say it twice. The re-read is the same as for every other
  // command, and as prompt; the pane keeps the reply it shows until the dialog
  // is dismissed (`reply-command-refusal.stories.tsx`).
  it.each(confirmed)(
    '$name hands the refusal to its confirmation, toasts nothing, and re-reads the reply, the lists and the counts',
    async (command) => {
      const { outcome, requests } = await refuse(command)

      expect(outcome).toBe(refusal)
      expect(vi.mocked(toast.error).mock.calls).toEqual([])
      expect(cachedDetail()?.reply?.status).toBe('rejected')
      expect(requests).toEqual({ detail: 2, list: 2, counts: 2 })
    },
  )

  it('approve names the reply and state revision its confirmation was opened on', async () => {
    mountPane(
      () => ({ item, reply: replyIn('pending_approval') }) as InboxItemDetailResult,
    )
    await pane.settle()
    const actions = pane.renderHooks(() =>
      useReplyActions({ reviewId: REVIEW_ID, onReplyChanged: () => {} }),
    )
    replyServer.approveReplyFn.mockResolvedValue(replyIn('approved'))

    await actions.approve(OPENED_ON)

    expect(replyServer.approveReplyFn.mock.calls).toEqual([
      [{ data: { reviewId: REVIEW_ID, expectedReply: OPENED_ON } }],
    ])
  })

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
    expect(vi.mocked(toast.error).mock.calls).toEqual([])
    expect(requests).toEqual({ detail: 1, list: 1, counts: 1 })
  })

  it('loads a template after the blur autosave and uses the revision that save returned', async () => {
    const initial = { ...replyIn('draft'), stateRevision: 1 }
    const saved = { ...initial, stateRevision: 2, text: 'Thank you for visiting.' }
    const loaded = { ...saved, stateRevision: 3, text: 'We appreciate your feedback.' }
    const pendingSave = Promise.withResolvers<typeof saved>()
    replyServer.draftReplyFn.mockReturnValueOnce(pendingSave.promise)
    replyServer.loadReplyTemplateFn.mockResolvedValueOnce(loaded)
    const actions = pane.renderHooks(() =>
      useReplyActions({
        reviewId: REVIEW_ID,
        reply: initial,
        onReplyChanged: () => {},
      }),
    )

    const save = actions.saveDraft(saved.text)
    await pane.settle()
    const load = actions.loadTemplate('builtin:thanks', { kind: 'property_default' })
    try {
      await pane.settle()
      // Clicking the template menu blurs the box. That save is part of this
      // editor's own work, so it must not make the next action stale.
      expect(replyServer.loadReplyTemplateFn).not.toHaveBeenCalled()
      pendingSave.resolve(saved)
      await Promise.all([save, load])
      expect(replyServer.loadReplyTemplateFn.mock.calls).toEqual([
        [
          {
            data: {
              reviewId: REVIEW_ID,
              templateId: 'builtin:thanks',
              targetLanguage: { kind: 'property_default' },
              expectedReply: { id: saved.id, stateRevision: saved.stateRevision },
            },
          },
        ],
      ])
    } finally {
      pendingSave.resolve(saved)
      await Promise.allSettled([save, load])
    }
  })

  it('finishes an autosave before deletion so its delayed response cannot revive the deleted revision', async () => {
    const initial = { ...replyIn('draft'), stateRevision: 1 }
    const saved = { ...initial, stateRevision: 2, text: 'Thank you for visiting.' }
    const recreated = { ...initial, id: 'reply-2' }
    const pendingSave = Promise.withResolvers<typeof saved>()
    replyServer.draftReplyFn.mockReturnValueOnce(pendingSave.promise)
    replyServer.draftReplyFn.mockResolvedValueOnce(recreated)
    replyServer.deleteReplyFn.mockResolvedValueOnce({ success: true, restarted: null })
    const actions = pane.renderHooks(() =>
      useReplyActions({
        reviewId: REVIEW_ID,
        reply: initial,
        onReplyChanged: () => {},
      }),
    )

    const save = actions.saveDraft(saved.text)
    await pane.settle()
    const deletion = actions.deleteDraft()
    try {
      await pane.settle()
      expect(replyServer.deleteReplyFn).not.toHaveBeenCalled()
      pendingSave.resolve(saved)
      await Promise.all([save, deletion])

      await actions.saveDraft(recreated.text)
      expect(replyServer.draftReplyFn.mock.calls[1]?.[0]).toMatchObject({
        data: { expectedReply: null },
      })
    } finally {
      pendingSave.resolve(saved)
      await Promise.allSettled([save, deletion])
    }
  })

  it('writes a new draft against the revision returned by clearing a failed reply', async () => {
    const failed = { ...replyIn('publish_failed'), stateRevision: 3 }
    const restarted = { id: failed.id, stateRevision: 4 }
    replyServer.deleteReplyFn.mockResolvedValueOnce({ success: true, restarted })
    replyServer.draftReplyFn.mockResolvedValueOnce({
      ...replyIn('draft'),
      ...restarted,
      stateRevision: 5,
      text: 'Thank you for visiting.',
    })
    const actions = pane.renderHooks(() =>
      useReplyActions({
        reviewId: REVIEW_ID,
        reply: failed,
        onReplyChanged: () => {},
      }),
    )

    await actions.deleteDraft()
    await actions.saveDraft('Thank you for visiting.')

    expect(replyServer.draftReplyFn).toHaveBeenCalledWith({
      data: expect.objectContaining({ expectedReply: restarted }),
    })
  })

  it('advances the original review fence when a pending mutation receives replacement callbacks', async () => {
    const initial = { ...replyIn('draft'), stateRevision: 1 }
    const saved = { ...initial, stateRevision: 2, text: 'Thank you for visiting.' }
    const final = { ...saved, stateRevision: 3, text: 'We hope to see you again.' }
    const pendingSave = Promise.withResolvers<typeof saved>()
    replyServer.draftReplyFn.mockReturnValueOnce(pendingSave.promise)
    replyServer.draftReplyFn.mockResolvedValueOnce(final)
    const actions = pane.renderHooks(() =>
      useReplyActions({
        reviewId: REVIEW_ID,
        reply: initial,
        onReplyChanged: () => {},
      }),
    )
    const firstSave = actions.saveDraft(saved.text)
    await pane.settle()
    const pendingMutation = pane.client.getMutationCache().getAll()[0]
    if (!pendingMutation) throw new Error('The draft mutation did not start')
    // Query replaces a pending mutation's options when the pane navigates.
    // The new pane's callback cannot advance the previous review's fence.
    pendingMutation.setOptions({
      ...pendingMutation.options,
      onSuccess: () => undefined,
    })
    const teardownSave = actions.saveDraft(final.text)
    try {
      pendingSave.resolve(saved)
      await Promise.all([firstSave, teardownSave])
      expect(replyServer.draftReplyFn.mock.calls[1]?.[0]).toMatchObject({
        data: {
          reviewId: REVIEW_ID,
          expectedReply: { id: saved.id, stateRevision: saved.stateRevision },
          text: final.text,
        },
      })
    } finally {
      pendingSave.resolve(saved)
      await Promise.allSettled([firstSave, teardownSave])
    }
  })
})

describe('a refused feedback-handling command', () => {
  type HandlingStatus = 'open' | 'closed'
  const open = makeInboxItem({ id: ITEM_ID, sourceType: 'feedback' })
  /** A closed cycle carries the outcome a correction supersedes. */
  const handling = (status: HandlingStatus) =>
    ({
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: status === 'open' ? 1 : 2,
      status,
      currentOutcome:
        status === 'closed'
          ? { id: '11111111-1111-4111-8111-111111111111', outcomeRevision: 1 }
          : null,
      history: [],
    }) as unknown as FeedbackHandlingState

  /**
   * The item's fence on the server, and the command that checks it. One
   * function stands in for both commands: each is fenced on the same revision
   * and leaves the cycle closed.
   */
  function feedbackServer(initialRevision: number, initialStatus: HandlingStatus) {
    const state = { revision: initialRevision, status: initialStatus }
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
  const submitDecision = (
    mode: 'mark' | 'correct',
    mutations: ReturnType<typeof renderHandling>,
  ) => {
    const detail = cachedDetail()!
    return submitFeedbackHandlingDecision({
      mode,
      item: detail.item,
      state: detail.feedbackHandling!,
      decision: { outcome: 'follow_up_completed', internalNote: null },
      markFeedbackHandled: mutations.markFeedbackHandled,
      correctFeedbackHandlingOutcome: mutations.correctFeedbackHandlingOutcome,
    })
  }

  it.each([
    { mode: 'mark', before: 'open' },
    { mode: 'correct', before: 'closed' },
  ] as const)(
    '$mode re-reads the item, so the next attempt carries its current revision',
    async ({ mode, before }) => {
      const server = feedbackServer(3, before)
      const requests = mountPane(server.readDetail)
      await pane.settle()
      const mutations = renderHandling(server)
      // A colleague added a note from another browser: the item is one further on.
      server.state.revision = 4

      const refused: unknown = await submitDecision(mode, mutations).catch(
        (error: unknown) => error,
      )
      await pane.settle()

      expect(refused).toMatchObject({
        code: 'revision_conflict',
        currentCommandRevision: 4,
      })
      expect(cachedDetail()?.item.commandRevision).toBe(4)
      expect(requests).toEqual({ detail: 2, list: 2, counts: 2 })

      await submitDecision(mode, mutations)

      expect(server.state).toEqual({ revision: 5, status: 'closed' })
      expect(cachedDetail()?.item).toMatchObject({
        commandRevision: 5,
        status: 'closed',
      })
    },
  )

  it('says the conflict in its own words, as a refusal and not a failure', async () => {
    const server = feedbackServer(3, 'open')
    mountPane(server.readDetail)
    await pane.settle()
    const mutations = renderHandling(server)
    server.state.revision = 4

    const refused: unknown = await submitDecision('mark', mutations).catch(
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
