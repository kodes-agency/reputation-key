import { act, Children, createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { LoginForm } from '#/contexts/identity/members/ui/login/login-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

const state = vi.hoisted(() => ({
  form: undefined as ComponentProps<typeof LoginForm> | undefined,
  signIn: vi.fn(),
  ensureActiveOrg: vi.fn(),
  destination: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => state.navigate,
  useRouter: () => ({ invalidate: state.invalidate, history: { push: state.push } }),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('#/shared/auth/auth.functions', () => ({
  getSession: vi.fn(),
  ensureActiveOrg: state.ensureActiveOrg,
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  signInUser: state.signIn,
  resendVerificationEmail: vi.fn(),
}))
vi.mock('./-sign-in-destination', () => ({ signInDestination: state.destination }))
vi.mock('#/components/layout/auth-layout', () => ({
  AuthCard: ({ children }: { children: ReactNode }) => Children.toArray(children)[0],
}))
vi.mock('#/components/ui/inline-link', () => ({ InlineLink: () => null }))
vi.mock('#/contexts/identity/members/ui/login/login-form', () => ({
  LoginForm: (props: ComponentProps<typeof LoginForm>) => {
    state.form = props
    return null
  },
}))

import { Route } from './login'

const root = setupHookRoot()
const input = { data: { email: 'manager@example.test', password: 'password' } }
const mutation = () => {
  if (!state.form) throw new Error('Login form did not render')
  return state.form.mutation
}

async function renderLogin(redirect?: string) {
  vi.spyOn(Route, 'useSearch').mockReturnValue({ redirect })
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  })
  const page = Route.options.component
  if (!page) throw new Error('Login page is missing')
  await root.render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(page)),
  )
  return queryClient
}

beforeEach(() => {
  vi.clearAllMocks()
  state.signIn.mockResolvedValue({})
  state.ensureActiveOrg.mockResolvedValue(undefined)
  state.destination.mockResolvedValue('/properties')
})

describe('login continuation', () => {
  it('keeps an organization lookup failure on the action for the form banner', async () => {
    const failure = new Error('organization storage unavailable')
    state.ensureActiveOrg.mockRejectedValueOnce(failure)
    const queryClient = await renderLogin()
    queryClient.setQueryData(['previous-tenant'], 'cached')

    await act(async () => {
      await expect(mutation()(input)).rejects.toBe(failure)
    })
    await root.flush()

    expect(mutation().error).toBe(failure)
    expect(mutation().isPending).toBe(false)
    expect(mutation().isSuccess).toBe(false)
    const banner = renderToStaticMarkup(
      createElement(FormErrorBanner, { error: mutation().error }),
    )
    expect(banner).toContain('Something went wrong. Try again.')
    expect(banner).not.toContain(failure.message)
    expect(state.invalidate).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['previous-tenant'])).toBe('cached')
  })

  it.each([
    { destination: '/properties', redirect: undefined, to: '/properties' },
    { destination: '/my', redirect: '/properties', to: '/my' },
  ])(
    'enters $to after clearing the old tenant cache',
    async ({ destination, redirect, to }) => {
      state.destination.mockResolvedValue(destination)
      const queryClient = await renderLogin(redirect)
      queryClient.setQueryData(['previous-tenant'], 'cached')
      state.navigate.mockImplementationOnce(async () => {
        expect(queryClient.getQueryData(['previous-tenant'])).toBeUndefined()
      })

      await act(async () => {
        await mutation()(input)
      })
      await root.flush()

      expect(state.signIn).toHaveBeenCalledExactlyOnceWith(input)
      expect(state.ensureActiveOrg).toHaveBeenCalledOnce()
      expect(state.invalidate).toHaveBeenCalledOnce()
      expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to })
      expect(state.push).not.toHaveBeenCalled()
    },
  )

  it('continues to the requested manager address', async () => {
    await renderLogin('/settings/profile')
    vi.useFakeTimers()
    try {
      await act(async () => {
        await mutation()(input)
      })
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      expect(vi.getTimerCount()).toBe(0)
      expect(mutation().isSuccess).toBe(true)
      expect(mutation().isPending).toBe(false)
      expect(state.push).toHaveBeenCalledExactlyOnceWith('/settings/profile')
      expect(state.navigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
