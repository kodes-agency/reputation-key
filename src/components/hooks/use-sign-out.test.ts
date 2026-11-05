import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { authClient } from '#/shared/auth/auth-client'
import {
  shellContextGeneration,
  shellContextKeys,
} from '#/shared/queries/shell-context-cache'
import { useSignOut } from './use-sign-out'

vi.mock('#/shared/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  createSerializationAdapter: (adapter: unknown) => adapter,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function renderSignOut(options?: Parameters<typeof useSignOut>[0]) {
  const queryClient = new QueryClient()
  const session = { user: { id: 'user-1' } }
  queryClient.setQueryData(shellContextKeys.session(), session)
  queryClient.setQueryData(['tenant-data'], ['cached'])
  let signOut: ReturnType<typeof useSignOut> | undefined
  function Harness() {
    signOut = useSignOut(options)
    return null
  }
  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
  )
  if (!signOut) throw new Error('Sign-out harness did not render')
  return { signOut, queryClient, session }
}

afterEach(() => vi.resetAllMocks())

describe('useSignOut', () => {
  it('waits for sign-out before clearing queries and mutations, then navigates', async () => {
    let finish: (() => void) | undefined
    vi.mocked(authClient.signOut).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { success: true }, error: null })
        }),
    )
    const onSignedOut = vi.fn(() => {
      expect(queryClient.getQueryCache().getAll()).toEqual([])
      expect(queryClient.getMutationCache().getAll()).toEqual([])
      expect(shellContextGeneration(queryClient)).toBe(1)
    })
    const { signOut, queryClient, session } = renderSignOut({ onSignedOut })
    const pending = signOut()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(queryClient.getQueryData(shellContextKeys.session())).toEqual(session)
    expect(onSignedOut).not.toHaveBeenCalled()
    finish?.()
    await pending
    expect(onSignedOut).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('clears state without navigation for the public header', async () => {
    vi.mocked(authClient.signOut).mockResolvedValue({
      data: { success: true },
      error: null,
    })
    const { signOut, queryClient } = renderSignOut()
    await signOut()
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(shellContextGeneration(queryClient)).toBe(1)
  })

  it.each([429, 500])(
    'keeps the session and caches on %s, shows retry feedback, and allows another attempt',
    async (status) => {
      vi.mocked(authClient.signOut)
        .mockResolvedValueOnce({
          data: null,
          error: { status, statusText: 'Request failed', message: 'Internal details' },
        })
        .mockResolvedValueOnce({ data: { success: true }, error: null })
      const onSignedOut = vi.fn()
      const { signOut, queryClient, session } = renderSignOut({ onSignedOut })
      await expect(signOut()).rejects.toThrow('Could not sign out. Please try again.')
      expect(queryClient.getQueryData(shellContextKeys.session())).toEqual(session)
      expect(queryClient.getQueryData(['tenant-data'])).toEqual(['cached'])
      expect(shellContextGeneration(queryClient)).toBe(0)
      expect(onSignedOut).not.toHaveBeenCalled()
      expect(authClient.signOut).toHaveBeenCalledOnce()
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'Could not sign out. Please try again.',
      )

      await signOut()
      expect(onSignedOut).toHaveBeenCalledOnce()
      expect(queryClient.getQueryCache().getAll()).toEqual([])
    },
  )

  it('keeps state and reports a rejected request without exposing its details', async () => {
    vi.mocked(authClient.signOut).mockRejectedValue(new TypeError('Failed to fetch'))
    const onSignedOut = vi.fn()
    const { signOut, queryClient, session } = renderSignOut({ onSignedOut })
    await expect(signOut()).rejects.toThrow('Failed to fetch')
    expect(queryClient.getQueryData(shellContextKeys.session())).toEqual(session)
    expect(queryClient.getQueryData(['tenant-data'])).toEqual(['cached'])
    expect(shellContextGeneration(queryClient)).toBe(0)
    expect(onSignedOut).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Could not sign out. Please try again.',
    )
  })

  it('passes a failure to the invitation banner without a second toast', async () => {
    vi.mocked(authClient.signOut).mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error' },
    })
    const handBack = vi.fn()
    const { signOut, queryClient, session } = renderSignOut({
      onSignedOut: handBack,
      feedback: 'inline',
    })
    await expect(signOut()).rejects.toThrow('Could not sign out. Please try again.')
    expect(queryClient.getQueryData(shellContextKeys.session())).toEqual(session)
    expect(handBack).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
