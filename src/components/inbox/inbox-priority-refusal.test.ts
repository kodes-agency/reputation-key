// Two managers set the same item's priority at once (owner P-8, plan D-7).
//
// An unrelated change in between (a note, an assignment) is absorbed: the
// server answers the stale revision with a conflict RESULT and the pane's one
// automatic retry sends the command again on the fresh revision. A change to
// the priority ITSELF is a thrown 409 `priority_changed`, which the retry must
// never replay — otherwise the second manager would overwrite the first without
// ever seeing their choice. The pane says so (copy C-9) and re-reads the item.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { inboxKeys } from '#/shared/queries/query-keys'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import type { InboxServerFns } from './types'
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

const ITEM_ID = '7b000000-0000-4000-8000-000000000001'
const C9 = 'Someone else changed the priority just now. Check it and choose again.'

const ITEM = {
  id: ITEM_ID,
  status: 'open',
  sourceType: 'review',
  commandRevision: 4,
  managerPriority: null,
} as unknown as InboxItem

type Command = InboxServerFns['setInboxItemPriority']

function renderPane(setInboxItemPriority: Command) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  queryClient.setQueryData(inboxKeys.detail(ITEM_ID), {
    item: ITEM,
    reply: null,
  } as unknown as InboxItemDetailResult)
  const unused = (async () => {
    throw new Error('not used here')
  }) as never
  const fns = {
    getInboxItemDetail: unused,
    getInboxNotes: unused,
    getInboxItemHistory: unused,
    updateInboxStatus: unused,
    escalateInboxItem: unused,
    resolveEscalation: unused,
    assignInboxItem: unused,
    setInboxItemPriority,
    markFeedbackHandled: unused,
    correctFeedbackHandlingOutcome: unused,
  }
  let state: InboxDetailState | undefined
  function Harness() {
    state = useInboxDetail(ITEM, true, fns, { selectedItemId: ITEM_ID })
    return null
  }
  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
  )
  if (!state) throw new Error('the pane harness did not render')
  return { state, queryClient }
}

const input = {
  data: {
    inboxItemId: ITEM_ID,
    expectedCommandRevision: 4,
    expectedPriority: null,
    priority: 'urgent' as const,
  },
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('setting a priority a colleague just changed', () => {
  it('is refused once, never retried, said in C-9, and re-reads the item', async () => {
    const command = vi.fn(async () => {
      throw new ServerFunctionError('InboxError', C9, 'priority_changed', 409)
    }) as unknown as Command
    const { state, queryClient } = renderPane(command)

    await state.setPriority(input).catch(() => undefined)

    expect(command).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith(C9)
    expect(queryClient.getQueryState(inboxKeys.detail(ITEM_ID))?.isInvalidated).toBe(true)
  })

  it('absorbs an unrelated change in between with the one revision retry', async () => {
    const conflict: InboxRevisionConflictResult = {
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 5,
      currentStatus: 'open',
    }
    const saved = { ...ITEM, commandRevision: 6, managerPriority: 'urgent' }
    const command = vi
      .fn()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(saved) as unknown as Command
    const { state } = renderPane(command)

    await state.setPriority(input)

    expect(command).toHaveBeenCalledTimes(2)
    expect(vi.mocked(command).mock.calls[1]?.[0]).toMatchObject({
      data: { expectedCommandRevision: 5, expectedPriority: null, priority: 'urgent' },
    })
    expect(toast.success).toHaveBeenCalledWith('Priority updated')
  })
})
