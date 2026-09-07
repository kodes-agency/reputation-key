import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from './use-action'
import { useActionMutation, type ActionMutationOptions } from './use-action-mutation'
import { inboxKeys } from '#/shared/queries/query-keys'
import type {
  InboxItemDetailResult,
  InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { withFreshCommandRevision } from '../inbox/use-inbox-detail'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
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
    const fn = vi.fn(
      async (_input: MutationInput): Promise<MutationOutput> => {
        throw rejection
      },
    )
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

describe('Inbox revision conflict recovery', () => {
  it('patches the authoritative revision and resubmits immediately once', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      inboxKeys.detail('item-1'),
      {
        item: { id: 'item-1', commandRevision: 1, status: 'open' },
        reply: null,
      } as unknown as InboxItemDetailResult,
    )
    const conflict: InboxRevisionConflictResult = {
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 2,
      currentStatus: 'closed',
    }
    const output: MutationOutput = { commandRevision: 3 }
    const command = vi
      .fn<
        (
          input: MutationInput,
        ) => Promise<MutationOutput | InboxRevisionConflictResult>
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
      queryClient.getQueryData<InboxItemDetailResult>(inboxKeys.detail('item-1'))
        ?.item,
    ).toMatchObject({ commandRevision: 2, status: 'closed' })
  })
})
