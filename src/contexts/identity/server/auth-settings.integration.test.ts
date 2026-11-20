// changePasswordFn, called as a signed-in member over PostgreSQL with real
// Better Auth: the other sessions end and the new password is the one that works.

import { hashPassword } from 'better-auth/crypto'
import { describe, expect, it, vi } from 'vitest'
import { getAuth } from '#/shared/auth/auth'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { changePasswordFn } from './auth-settings'

const harness = setupServerFunctionHarness()

const CURRENT = 'current-password-123!'
const NEXT = 'next-password-456!'

async function adminWithKnownPassword() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  await harness
    .pool()
    .query(`UPDATE account SET password = $2 WHERE "userId" = $1`, [
      admin.userId,
      await hashPassword(CURRENT),
    ])
  return admin
}

const signIn = (member: TestMember, password: string) =>
  getAuth().api.signInEmail({ body: { email: member.email, password } })

async function sessionCount(member: TestMember): Promise<number> {
  const { rows } = await harness
    .pool()
    .query(`SELECT count(*)::int AS n FROM session WHERE "userId" = $1`, [member.userId])
  return rows[0].n
}

describe('changePasswordFn', () => {
  it('sets the new password and ends every other session of the member', async () => {
    const admin = await adminWithKnownPassword()
    await signIn(admin, CURRENT)
    expect(await sessionCount(admin)).toBe(2)

    await harness.callAs(admin, () =>
      changePasswordFn({ data: { currentPassword: CURRENT, newPassword: NEXT } }),
    )

    expect(await sessionCount(admin)).toBe(1)
    await expect(signIn(admin, NEXT)).resolves.toBeTruthy()
    await expect(signIn(admin, CURRENT)).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })

  it('refuses a wrong current password and keeps the old one', async () => {
    const admin = await adminWithKnownPassword()

    await expect(
      harness.callAs(admin, () =>
        changePasswordFn({
          data: { currentPassword: 'wrong-password-1', newPassword: NEXT },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })

    await expect(signIn(admin, CURRENT)).resolves.toBeTruthy()
  })

  it('refuses a new password that is too short before reading anything', async () => {
    const admin = await adminWithKnownPassword()

    await expect(
      harness.callAs(admin, () =>
        changePasswordFn({ data: { currentPassword: CURRENT, newPassword: 'short' } }),
      ),
    ).rejects.toThrow(/at least 8/)

    await expect(signIn(admin, CURRENT)).resolves.toBeTruthy()
  })

  it('refuses a staff-only login and a caller with no session', async () => {
    const organization = await harness.seedOrganization()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () =>
        changePasswordFn({ data: { currentPassword: CURRENT, newPassword: NEXT } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () =>
        changePasswordFn({ data: { currentPassword: CURRENT, newPassword: NEXT } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})
