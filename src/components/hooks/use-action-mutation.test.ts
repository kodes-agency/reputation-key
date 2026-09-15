import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from './use-action'
import {
  actionErrorMessage,
  GENERIC_ACTION_ERROR_MESSAGE,
  useActionMutation,
  type ActionMutationOptions,
} from './use-action-mutation'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { inboxKeys } from '#/shared/queries/query-keys'
import type {
  InboxItemDetailResult,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { withFreshCommandRevision } from '../inbox/use-inbox-detail'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  // `server-function-error.ts` builds its wire adapter at module load; the
  // adapter is irrelevant here, only the class and its recogniser are used.
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

type MutationInput = Readonly<{
  data: Readonly<{ inboxItemId: string; expectedCommandRevision: number }>
}>

type MutationOutput = Readonly<{ commandRevision: number }>

function renderAction<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options?: ActionMutationOptions<TInput, TOutput>,
): Action<TInput, TOutput> {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  let action: Action<TInput, TOutput> | undefined

  function Harness() {
    action = useActionMutation(fn, options)
    return null
  }

  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
  )

  if (!action) throw new Error('useActionMutation harness did not render')
  return action
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useActionMutation recovery', () => {
  it('resubmits the rebuilt input a recovery returns', async () => {
    const rejection = { code: 'revision_conflict' }
    const initialInput: MutationInput = {
      data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
    }
    const rebuiltInput: MutationInput = {
      data: { inboxItemId: 'item-1', expectedCommandRevision: 2 },
    }
    const output: MutationOutput = { commandRevision: 3 }
    const fn = vi
      .fn<(input: MutationInput) => Promise<MutationOutput>>()
      .mockRejectedValueOnce(rejection)
      .mockResolvedValueOnce(output)
    const recover = vi.fn(
      async (_input: MutationInput, _error: unknown): Promise<MutationInput | null> =>
        rebuiltInput,
    )
    const action = renderAction(fn, { recover })

    await expect(action(initialInput)).resolves.toBe(output)

    expect(recover).toHaveBeenCalledOnce()
    expect(recover).toHaveBeenCalledWith(initialInput, rejection)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, initialInput)
    expect(fn).toHaveBeenNthCalledWith(2, rebuiltInput)
  })

  it('never resubmits a recovered mutation more than once', async () => {
    const rejection = { code: 'revision_conflict' }
    const input = (revision: number): MutationInput => ({
      data: { inboxItemId: 'item-1', expectedCommandRevision: revision },
    })
    const fn = vi.fn(async (_input: MutationInput): Promise<MutationOutput> => {
      throw rejection
    })
    const recover = vi.fn(async (): Promise<MutationInput | null> => input(2))

    await expect(renderAction(fn, { recover })(input(1))).rejects.toBe(rejection)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, input(1))
    expect(fn).toHaveBeenNthCalledWith(2, input(2))
    expect(recover).toHaveBeenCalledOnce()
  })

  it('lets the rejection stand when the recovery declines', async () => {
    const rejection = new Error('request failed')
    const input: MutationInput = {
      data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
    }
    const fn = vi.fn(async (_input: MutationInput): Promise<MutationOutput> => {
      throw rejection
    })
    const recover = vi.fn(
      async (_input: MutationInput, _error: unknown): Promise<MutationInput | null> =>
        null,
    )
    const action = renderAction(fn, { recover })

    await expect(action(input)).rejects.toBe(rejection)

    expect(fn).toHaveBeenCalledOnce()
    expect(recover).toHaveBeenCalledOnce()
  })

  it('rejects untouched when no recovery is supplied', async () => {
    const rejection = new Error('request failed')
    const input: MutationInput = {
      data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
    }
    const fn = vi.fn(async (_input: MutationInput): Promise<MutationOutput> => {
      throw rejection
    })

    await expect(renderAction(fn)(input)).rejects.toBe(rejection)
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('useActionMutation error feedback', () => {
  const input: MutationInput = {
    data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
  }
  const rejectingWith = (rejection: unknown) =>
    vi.fn(async (_input: MutationInput): Promise<MutationOutput> => {
      throw rejection
    })

  it('toasts the server message when a server function refuses with a 4xx', async () => {
    const refusal = new ServerFunctionError(
      'ReviewError',
      'This reply has nothing to check on Google.',
      'invalid_transition',
      400,
    )
    const action = renderAction(rejectingWith(refusal), {
      errorMessage: actionErrorMessage,
    })

    await expect(action(input)).rejects.toBe(refusal)

    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('This reply has nothing to check on Google.')
  })

  it('toasts the generic sentence for a 5xx, never the server wording', async () => {
    const failure = new ServerFunctionError(
      'InternalError',
      'relation "replies" does not exist',
      'internal_error',
      500,
    )
    const action = renderAction(rejectingWith(failure), {
      errorMessage: actionErrorMessage,
    })

    await expect(action(input)).rejects.toBe(failure)

    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith(GENERIC_ACTION_ERROR_MESSAGE)
    expect(GENERIC_ACTION_ERROR_MESSAGE).toBe('Something went wrong. Try again.')
  })

  it('toasts the generic sentence for an error that is not a server refusal', async () => {
    const action = renderAction(rejectingWith(new TypeError('Failed to fetch')), {
      errorMessage: actionErrorMessage,
    })

    await expect(action(input)).rejects.toBeInstanceOf(TypeError)

    expect(toast.error).toHaveBeenCalledWith(GENERIC_ACTION_ERROR_MESSAGE)
  })

  it('toasts a fixed sentence when errorMessage is a string', async () => {
    const action = renderAction(rejectingWith(new Error('boom')), {
      errorMessage: 'The reply could not be deleted.',
    })

    await expect(action(input)).rejects.toThrow('boom')

    expect(toast.error).toHaveBeenCalledWith('The reply could not be deleted.')
  })

  it('does not toast a rejection when errorMessage is omitted', async () => {
    const refusal = new ServerFunctionError('ReviewError', 'Refused', 'forbidden', 403)

    await expect(renderAction(rejectingWith(refusal))(input)).rejects.toBe(refusal)

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('hands a rejection and the submitted input to onError, after the toast', async () => {
    const refusal = new ServerFunctionError('ReviewError', 'Refused', 'forbidden', 403)
    const onError = vi.fn(() => {
      expect(toast.error).toHaveBeenCalledWith('Refused')
    })
    const action = renderAction(rejectingWith(refusal), {
      errorMessage: actionErrorMessage,
      onError,
    })

    await expect(action(input)).rejects.toBe(refusal)

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(refusal, input)
  })

  it('does not toast a rejection its recovery turned into a success', async () => {
    const fn = vi
      .fn<(input: MutationInput) => Promise<MutationOutput>>()
      .mockRejectedValueOnce(new ServerFunctionError('InboxError', 'x', 'conflict', 409))
      .mockResolvedValueOnce({ commandRevision: 2 })
    const action = renderAction(fn, {
      errorMessage: actionErrorMessage,
      recover: async () => input,
    })

    await expect(action(input)).resolves.toEqual({ commandRevision: 2 })

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('Inbox revision conflict recovery', () => {
  it('patches the authoritative revision and resubmits immediately once', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(inboxKeys.detail('item-1'), {
      item: { id: 'item-1', commandRevision: 1, status: 'open' },
      reply: null,
    } as unknown as InboxItemDetailResult)
    const conflict: InboxRevisionConflictResult = {
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 2,
      currentStatus: 'closed',
    }
    const output: MutationOutput = { commandRevision: 3 }
    const command = vi
      .fn<
        (input: MutationInput) => Promise<MutationOutput | InboxRevisionConflictResult>
      >()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(output)

    const action = withFreshCommandRevision(queryClient, 'item-1', command)
    await expect(
      action({
        data: { inboxItemId: 'item-1', expectedCommandRevision: 1 },
      }),
    ).resolves.toBe(output)

    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[1]?.[0].data.expectedCommandRevision).toBe(2)
    expect(
      queryClient.getQueryData<InboxItemDetailResult>(inboxKeys.detail('item-1'))?.item,
    ).toMatchObject({ commandRevision: 2, status: 'closed' })
  })
})
