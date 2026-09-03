import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from './use-action'
import { useActionMutation, type ActionMutationOptions } from './use-action-mutation'

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

  it('keeps resubmitting while the recovery rebuilds, then stops at the bound', async () => {
    // The Inbox read model converges on the outbox relay's own tick, so a
    // manager action can lose the revision race more than once in a row.
    const rejection = { code: 'revision_conflict' }
    const input = (revision: number): MutationInput => ({
      data: { inboxItemId: 'item-1', expectedCommandRevision: revision },
    })
    const output: MutationOutput = { commandRevision: 9 }
    const recovering = vi
      .fn<(input: MutationInput) => Promise<MutationOutput>>()
      .mockRejectedValueOnce(rejection)
      .mockRejectedValueOnce(rejection)
      .mockResolvedValueOnce(output)
    let revision = 1
    const rebuild = vi.fn(async (): Promise<MutationInput | null> => input(++revision))

    await expect(renderAction(recovering, { recover: rebuild })(input(1))).resolves.toBe(
      output,
    )
    expect(recovering).toHaveBeenCalledTimes(3)
    expect(recovering).toHaveBeenNthCalledWith(3, input(3))

    const alwaysRejecting = vi.fn(
      async (_input: MutationInput): Promise<MutationOutput> => {
        throw rejection
      },
    )
    revision = 1
    await expect(
      renderAction(alwaysRejecting, { recover: rebuild })(input(1)),
    ).rejects.toBe(rejection)
    // Four attempts: the original plus RECOVERY_LIMIT resubmissions.
    expect(alwaysRejecting).toHaveBeenCalledTimes(4)
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
