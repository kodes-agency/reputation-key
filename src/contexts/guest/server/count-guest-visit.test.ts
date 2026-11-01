import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldCountGuestVisit } from './count-guest-visit'
const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn() }))
vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({ api: { getSession: mocks.session } }),
}))
vi.mock('#/shared/auth/user-organization-membership-authority', () => ({
  checkUserOrganizationMembership: mocks.membership,
}))
beforeEach(() => vi.resetAllMocks())
const headers = new Headers({ cookie: '__Secure-better-auth.session_token=token' })
describe('own Organization visits', () => {
  it('does no lookup for an anonymous guest', async () => {
    expect(
      await shouldCountGuestVisit(new Headers({ cookie: 'guest-session=x' }), 'org'),
    ).toBe(true)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.membership).not.toHaveBeenCalled()
  })
  it('excludes a signed-in Member of the Portal Organization', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'staff' } })
    mocks.membership.mockResolvedValue({ kind: 'allow' })
    expect(await shouldCountGuestVisit(headers, 'org')).toBe(false)
  })
  it('counts an account from another Organization', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'visitor' } })
    mocks.membership.mockResolvedValue({ kind: 'deny' })
    expect(await shouldCountGuestVisit(headers, 'org')).toBe(true)
  })
  it('counts the visit when the account lookup fails', async () => {
    mocks.session.mockRejectedValue(new Error('Session unavailable'))
    expect(await shouldCountGuestVisit(headers, 'org')).toBe(true)
  })
})
