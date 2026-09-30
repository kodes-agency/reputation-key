import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { isNotFound } from '@tanstack/react-router'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { platformKeys } from '#/shared/queries/query-keys'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listPlatformOrganizationsFn: vi.fn(),
}))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession: mocks.getSession }))
vi.mock('#/shared/auth/auth-client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('#/contexts/identity/server/platform-console', () => ({
  listPlatformOrganizationsFn: mocks.listPlatformOrganizationsFn,
  provisionOrganizationFn: vi.fn(),
  inviteOrganizationAdminFn: vi.fn(),
  resendOrganizationAdminInvitationFn: vi.fn(),
  cancelOrganizationAdminInvitationFn: vi.fn(),
}))

import { platformOrganizationsQuery, Route } from './operator'

const SESSION = {
  user: { id: 'user-1', name: 'Bo', email: 'owner@example.com' },
  session: { createdAt: new Date() },
}

function beforeLoad() {
  const hook = Route.options.beforeLoad
  if (!hook) throw new Error('The operator route must define beforeLoad')
  return hook({ location: { href: '/operator' } } as never)
}

function load(queryClient: QueryClient) {
  const loader = Route.options.loader
  if (typeof loader !== 'function') {
    throw new Error('The operator route must define a loader function')
  }
  return loader({ context: { queryClient } } as never)
}

const refusal = (code: string, status: number) =>
  new ServerFunctionError(
    'AuthError',
    'This page is for platform operators.',
    code,
    status,
  )

describe('operator route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a signed-out visitor to sign in and back to the console', async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(beforeLoad()).rejects.toMatchObject({
      options: { to: '/login', search: { redirect: '/operator' } },
    })
  })

  it('lets any signed-in user through to the loader, which asks the server who is an operator', async () => {
    mocks.getSession.mockResolvedValue(SESSION)

    await expect(beforeLoad()).resolves.toBeUndefined()
  })

  it('primes the Organization list under its platform key', async () => {
    const organizations = [{ id: 'org-1', name: 'Hotel Riviera' }]
    mocks.listPlatformOrganizationsFn.mockResolvedValue(organizations)
    const queryClient = new QueryClient()

    await load(queryClient)

    expect(platformOrganizationsQuery.queryKey).toEqual(platformKeys.organizations())
    expect(queryClient.getQueryData(platformKeys.organizations())).toEqual(organizations)
  })

  it.each([
    ['operator_not_registered', 'an unregistered user'],
    ['forbidden', 'any other 403'],
  ])('answers Not Found to %s (%s), so the console is not advertised', async (code) => {
    mocks.listPlatformOrganizationsFn.mockRejectedValue(refusal(code, 403))

    const thrown = await load(new QueryClient()).catch((error: unknown) => error)

    expect(isNotFound(thrown)).toBe(true)
  })

  it.each([401, 500])('does not turn a %s into Not Found', async (status) => {
    const failure = refusal('unauthorized', status)
    mocks.listPlatformOrganizationsFn.mockRejectedValue(failure)

    const thrown = await load(new QueryClient()).catch((error: unknown) => error)

    expect(thrown).toBe(failure)
    expect(isNotFound(thrown)).toBe(false)
  })
})
