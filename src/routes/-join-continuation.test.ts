import {
  act,
  Children,
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { RegisterForm } from '#/contexts/identity/members/ui/registration/register-form'
import type { JoinEntryCard } from '#/contexts/identity/members/ui/registration/join-entry-card'

const state = vi.hoisted(() => ({
  form: undefined as ComponentProps<typeof RegisterForm> | undefined,
  entry: undefined as ComponentProps<typeof JoinEntryCard> | undefined,
  title: '',
  register: vi.fn(),
  ensureActiveOrg: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => state.navigate,
  useRouter: () => ({ navigate: state.navigate }),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('#/shared/auth/auth.functions', () => ({
  ensureActiveOrg: state.ensureActiveOrg,
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  registerMember: state.register,
}))
vi.mock('#/components/layout/auth-layout', () => ({
  AuthCard: ({ title, children }: { title: string; children: ReactNode }) => {
    state.title = title
    if (title !== 'Create your account') return null
    const fields = Children.toArray(children)[0]
    return isValidElement<{ children: ReactNode }>(fields) ? fields.props.children : null
  },
  AuthFooterLink: () => null,
}))
vi.mock('#/contexts/identity/members/ui/registration/invitation-state-card', () => ({
  InvitationLinkStateCard: () => null,
}))
vi.mock('#/contexts/identity/members/ui/registration/invitation-summary', () => ({
  InvitationSummary: () => null,
}))
vi.mock('#/contexts/identity/members/ui/registration/register-form', () => ({
  RegisterForm: (props: ComponentProps<typeof RegisterForm>) => {
    state.form = props
    return null
  },
}))
vi.mock('#/contexts/identity/members/ui/registration/join-entry-card', () => ({
  JoinEntryCard: (props: ComponentProps<typeof JoinEntryCard>) => {
    state.entry = props
    return null
  },
}))

import { Route } from './join'

const root = setupHookRoot()
const input = {
  data: {
    name: 'Manager',
    email: 'manager@example.test',
    password: 'password',
    invitationId: 'invitation-1',
  },
}
const mutation = () => {
  if (!state.form) throw new Error('Registration form did not render')
  return state.form.mutation
}
const entry = () => {
  if (!state.entry) throw new Error('Workspace entry card did not render')
  return state.entry
}

async function renderJoin() {
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({
    link: {
      state: 'pending',
      invitationId: 'invitation-1',
      invitedEmail: input.data.email,
      details: {
        organizationName: 'Example',
        inviterName: null,
        role: 'Member',
        propertyNames: [],
        expiresAt: new Date('2026-12-01'),
      },
    },
  } as ReturnType<typeof Route.useRouteContext>)
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  })
  const page = Route.options.component
  if (!page) throw new Error('Join page is missing')
  await root.render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(page)),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.form = undefined
  state.entry = undefined
  state.register.mockResolvedValue({ signedIn: true })
  state.ensureActiveOrg.mockResolvedValue(undefined)
})

describe('registration continuation', () => {
  it('shows entry progress while organization lookup is pending', async () => {
    let release: (() => void) | undefined
    state.ensureActiveOrg.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await renderJoin()
    let result: Promise<unknown> | undefined
    await act(async () => {
      result = mutation()(input)
    })
    await root.flush()

    expect(entry().status).toBe('entering')
    expect(state.navigate).not.toHaveBeenCalled()
    await act(async () => {
      release?.()
      await result
    })
    await root.flush()
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/my' })
  })

  it('offers a workspace retry after registration without creating the account again', async () => {
    state.ensureActiveOrg.mockRejectedValueOnce(new Error('organization unavailable'))
    await renderJoin()
    await act(async () => {
      await mutation()(input)
    })
    await root.flush()

    expect(entry().status).toBe('failed')
    expect(state.navigate).not.toHaveBeenCalled()
    await act(async () => entry().onRetry())
    await root.flush()

    expect(state.register).toHaveBeenCalledExactlyOnceWith(input)
    expect(state.ensureActiveOrg).toHaveBeenCalledTimes(2)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/my' })
  })

  it('asks the new member to sign in when registration did not set a session', async () => {
    state.register.mockResolvedValueOnce({ signedIn: false })
    await renderJoin()
    await act(async () => {
      await mutation()(input)
    })
    await root.flush()

    expect(state.title).toBe('Account created!')
    expect(state.ensureActiveOrg).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
  })
})
