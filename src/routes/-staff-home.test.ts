import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  home: vi.fn(),
  session: vi.fn(),
  organization: vi.fn(),
  ensure: vi.fn(),
}))
vi.mock('#/shared/auth/auth.functions', () => ({
  getSession: mocks.session,
  ensureActiveOrg: mocks.ensure,
}))
vi.mock('#/contexts/identity/server/staff-self', () => ({
  getMyStaffHome: mocks.home,
  getMyCode: vi.fn(),
  acknowledgeStaffNotice: vi.fn(),
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization: mocks.organization,
}))
vi.mock('#/contexts/reporting/server/staff-self-results', () => ({
  getMyResults: vi.fn(),
  getMyGoals: vi.fn(),
  getMyColleagues: vi.fn(),
}))
vi.mock('#/contexts/identity/server/staff-self-account', () => ({
  changeMyStaffPassword: vi.fn(),
  submitMyStaffFeedback: vi.fn(),
  listMyStaffFeedback: vi.fn(),
}))
import { staffHomeEntry } from './-staff-home-entry'
import { signInDestination } from './-sign-in-destination'
import { validateStaffHomeSearch } from '#/shared/staff-home-search'
import { staffHomeFns } from './-staff-home-fns'
import { Route as MyRoute } from './my'
import { Route as MyCodeRoute } from './_authenticated/my-code'
import { Route as MyLazy } from './my.lazy'
import { Route as MyCodeLazy } from './_authenticated/my-code.lazy'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

const home = { participations: [{ participationId: 'own' }] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'polly' } })
  mocks.home.mockResolvedValue(home)
})
describe('staff routes', () => {
  it('lands a staff sign-in on my and keeps managers in their workspace', async () => {
    mocks.organization.mockResolvedValue({ availability: 'staff' })
    expect(await signInDestination()).toBe('/my')
    mocks.organization.mockResolvedValue({ availability: 'available' })
    expect(await signInDestination()).toBe('/properties')
    mocks.organization.mockRejectedValue(
      new ServerFunctionError('AuthError', 'Staff login', 'beta_role_inactive', 403),
    )
    expect(await signInDestination()).toBe('/my')
  })
  it('returns a signed-out arrival through login with the full return path', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(staffHomeEntry('/my?tab=results')).rejects.toMatchObject({
      options: { to: '/login', search: { redirect: '/my?tab=results' } },
    })
    expect(mocks.home).not.toHaveBeenCalled()
  })
  it('refuses missing staff access and a capability that is off', async () => {
    for (const code of ['forbidden', 'capability_disabled']) {
      mocks.home.mockRejectedValue(
        new ServerFunctionError('AuthError', 'Not available', code, 403),
      )
      await expect(staffHomeEntry('/my')).rejects.toMatchObject({
        options: { to: '/unavailable' },
      })
    }
  })
  it('keeps an infrastructure failure available for retry', async () => {
    const error = new Error('database down')
    mocks.home.mockRejectedValue(error)
    await expect(staffHomeEntry('/my')).rejects.toBe(error)
  })
  it('opens a manager personal code through the same owned home read', async () => {
    expect(await staffHomeEntry('/my-code')).toEqual({
      staffHome: home,
      staffUserId: 'polly',
    })
    const beforeLoad = MyCodeRoute.options.beforeLoad
    if (!beforeLoad) throw new Error('My code needs an entry guard')
    expect(await beforeLoad({ location: { href: '/my-code' } } as never)).toEqual({
      staffHome: home,
      staffUserId: 'polly',
    })
  })
  it('keeps feature code lazy and the manifest on my alone', () => {
    expect(MyRoute.options.validateSearch).toBe(validateStaffHomeSearch)
    expect(MyCodeRoute.options.validateSearch).toBe(validateStaffHomeSearch)
    expect(MyRoute.options.head?.({} as never)).toMatchObject({
      links: expect.arrayContaining([{ rel: 'manifest', href: '/staff.webmanifest' }]),
    })
    expect(MyCodeRoute.options.head).toBeUndefined()
    expect(MyLazy.options.component).toBeTypeOf('function')
    expect(MyCodeLazy.options.component).toBeTypeOf('function')
    expect(staffHomeFns.getMyStaffHome).toBe(mocks.home)
  })
})
