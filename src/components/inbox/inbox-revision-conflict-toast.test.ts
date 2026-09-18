// What the manager is told when a fenced command conflicts twice.
//
// `withFreshCommandRevision` spends its one retry on the first conflict and
// writes its own sentence for the second. Escalate, resolve and assign report a
// refusal only through their `errorMessage: actionErrorMessage` toast
// (`use-inbox-detail.ts`), and `actionErrorMessage` shows a message verbatim
// only for a 4xx server refusal — so the thrown error has to carry that shape,
// or the pane's own sentence is replaced by the generic failure line.
//
// Its own file rather than a case in `use-action-mutation.test.ts`: that suite
// belongs to the hook; this one pins the inbox's use of it.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { isExpectedRefusal } from '#/shared/security/expected-refusal'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  isInboxRevisionConflictResult,
  type InboxItemDetailResult,
  type InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { withFreshCommandRevision } from './use-inbox-detail'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; the
  // adapter is irrelevant here, only the recogniser is used.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

type CommandInput = Readonly<{
  data: Readonly<{ inboxItemId: string; expectedCommandRevision: number }>
}>

type CommandOutput = Readonly<{ commandRevision: number }>

const CONFLICT_AGAIN = 'This item changed again while you were working. Please try again.'

function conflictAt(revision: number): InboxRevisionConflictResult {
  return {
    ok: false,
    code: 'revision_conflict',
    currentCommandRevision: revision,
    currentStatus: 'open',
  }
}

/** The pane's wiring: the fenced command inside a toasting Action. */
function renderFencedAction(
  queryClient: QueryClient,
  command: (input: CommandInput) => Promise<CommandOutput | InboxRevisionConflictResult>,
): Action<CommandInput, CommandOutput> {
  let action: Action<CommandInput, CommandOutput> | undefined

  function Harness() {
    action = useActionMutation(withFreshCommandRevision(queryClient, 'item-1', command), {
      errorMessage: actionErrorMessage,
    })
    return null
  }

  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
  )
  if (!action) throw new Error('fenced action harness did not render')
  return action
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('a second revision conflict', () => {
  it("toasts the pane's own sentence, not the generic failure", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    queryClient.setQueryData(inboxKeys.detail('item-1'), {
      item: { id: 'item-1', commandRevision: 1, status: 'open' },
      reply: null,
    } as unknown as InboxItemDetailResult)
    const command = vi
      .fn<(input: CommandInput) => Promise<CommandOutput | InboxRevisionConflictResult>>()
      .mockResolvedValueOnce(conflictAt(2))
      .mockResolvedValueOnce(conflictAt(3))
    const action = renderFencedAction(queryClient, command)

    const refusal: unknown = await action({
      data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
    }).then(
      () => {
        throw new Error('a second conflict must reject')
      },
      (error: unknown) => error,
    )

    expect(command).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith(CONFLICT_AGAIN)
    // A refusal, not a failure: the browser SDK drops it rather than paging.
    expect(isExpectedRefusal(refusal)).toBe(true)
    // Still the conflict the server returned, for any caller that reads it.
    expect(isInboxRevisionConflictResult(refusal)).toBe(true)
    expect(refusal).toMatchObject({ message: CONFLICT_AGAIN, currentCommandRevision: 3 })
  })
})
