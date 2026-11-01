import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveStaff } from './staff-resolver'
import { resolveSessionOrganization } from './session-organization'
import { resetEnv } from '#/shared/config/env'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  membership: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('./auth', () => ({
  getAuth: () => ({ api: { getSession: mocks.session, getActiveMember: mocks.member } }),
}))
vi.mock('./user-organization-membership-authority', () => ({
  checkUserOrganizationMembership: mocks.membership,
}))
vi.mock('./execution-policy', () => ({ requireExecutionAllowed: mocks.policy }))

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ENABLE_CUSTOM_ROLES = 'false'
  resetEnv()
  mocks.session.mockResolvedValue({
    session: { activeOrganizationId: 'org' },
    user: { id: 'person' },
  })
  mocks.membership.mockResolvedValue({ kind: 'allow' })
  mocks.member.mockResolvedValue({ role: 'member' })
})

describe('staff door', () => {
  it('shares session and sole Organization admission', async () => {
    expect(await resolveSessionOrganization(new Headers())).toMatchObject({
      activeOrgId: 'org',
    })
    mocks.membership.mockResolvedValue({ kind: 'deny', reason: 'no_membership' })
    await expect(resolveStaff(new Headers())).rejects.toMatchObject({
      code: 'organization_membership_conflict',
    })
    expect(mocks.policy).not.toHaveBeenCalled()
  })

  it.each(['member', 'owner', 'admin'])(
    'admits %s only through staff.accounts policy',
    async (role) => {
      mocks.member.mockResolvedValue({ role })
      const ctx = await resolveStaff(new Headers())
      expect(ctx.effectivePermissions?.has('staff.self')).toBe(true)
      expect(mocks.policy).toHaveBeenCalledWith({
        actor: ctx,
        action: 'staff.self',
        capability: 'staff.accounts',
      })
    },
  )

  it('sees membership removal on the next request', async () => {
    await resolveStaff(new Headers())
    mocks.member.mockResolvedValue(null)
    await expect(resolveStaff(new Headers())).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.member).toHaveBeenCalledTimes(2)
  })

  it.each(['org_suspended', 'capability_blocked'])(
    'propagates %s without returning authority',
    async (code) => {
      mocks.policy.mockRejectedValue(Object.assign(new Error('Access paused'), { code }))
      await expect(resolveStaff(new Headers())).rejects.toMatchObject({ code })
    },
  )
})
