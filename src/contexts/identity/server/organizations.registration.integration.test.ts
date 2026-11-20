// Sign-in, registration through an invitation, the verification-link resend and
// the invitation list, called over PostgreSQL and the test Redis with the real
// Better Auth, rate limiter and client address.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { requireHarnessRedis } from '#/shared/testing/server-function-require-redis'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { INVITATION_PAUSED_MESSAGE } from '../domain/invitation-copy'
import {
  listUserInvitations,
  registerMember,
  resendVerificationEmail,
  signInUser,
} from './organizations.registration'

const SUSPENDED_ORGANIZATION_ID = `org-suspended-${randomUUID()}`

const harness = setupServerFunctionHarness({
  env: {
    EMAIL_VERIFICATION_REQUIRED: 'true',
    TRUSTED_PROXY_MODE: 'xff',
    TRUSTED_PROXY_COUNT: '1',
    BETA_SUSPENDED_ORGS: SUSPENDED_ORGANIZATION_ID,
    RESEND_BASE_URL: 'http://127.0.0.1:9',
  },
  redis: true,
})

const NEW_PASSWORD = 'Password123!'
const HOUR_MS = 60 * 60 * 1000

let nextClient = 1
/** A request from an address no other test uses, so the per-IP budgets never meet. */
function fromNewAddress() {
  nextClient += 1
  return {
    headers: { 'x-forwarded-for': `198.51.${nextClient % 250}.${(nextClient >> 8) + 1}` },
  }
}

async function unverifiedMember() {
  const organization = await harness.seedOrganization()
  const member = await harness.seedMember(organization, 'Member')
  await harness
    .pool()
    .query(`UPDATE "user" SET "emailVerified" = false WHERE id = $1`, [member.userId])
  return member
}

async function invitedPerson(organizationId?: string) {
  const organization = organizationId
    ? await harness.seedOrganization({ id: organizationId })
    : await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const email = `new.${randomUUID()}@example.test`
  const invitation = await harness.seedInvitation(organization, {
    inviter: admin,
    email,
    role: 'PropertyManager',
  })
  return { organization, invitation, email }
}

async function userIdOf(email: string): Promise<string | undefined> {
  const { rows } = await harness
    .pool()
    .query(`SELECT id FROM "user" WHERE email = $1`, [email])
  const id = rows[0]?.id as string | undefined
  if (id) harness.trackUser(id)
  return id
}

describe('signInUser', () => {
  it('signs a verified member in and hands the session cookie to the browser', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')

    const response = await harness.respondAs(
      null,
      () => signInUser({ data: { email: member.email, password: member.password } }),
      fromNewAddress(),
    )

    expect(response.ok).toBe(true)
    const cookies = response.headers.getSetCookie()
    expect(cookies.filter((cookie) => cookie.includes('session_token'))).toHaveLength(1)
  })

  it('reports an unverified address as 403 email_not_verified', async () => {
    const member = await unverifiedMember()

    await expect(
      harness.callAs(
        null,
        () => signInUser({ data: { email: member.email, password: member.password } }),
        fromNewAddress(),
      ),
    ).rejects.toMatchObject({
      code: 'email_not_verified',
      status: 403,
      message: 'Verify your email before signing in.',
    })
  })

  it('keeps a wrong password and an unknown address a 401 invalid_credentials', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')

    for (const data of [
      { email: member.email, password: 'wrong-password-1' },
      { email: 'nobody@example.test', password: member.password },
    ]) {
      await expect(
        harness.callAs(null, () => signInUser({ data }), fromNewAddress()),
      ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 })
    }
  })
})

describe('registerMember', () => {
  it('consumes the invitation, creates the account and member, and signs the person in', async () => {
    const { organization, invitation, email } = await invitedPerson()

    const response = await harness.respondAs(
      null,
      () =>
        registerMember({
          data: {
            invitationId: invitation.id,
            name: 'New Manager',
            email,
            password: NEW_PASSWORD,
          },
        }),
      fromNewAddress(),
    )
    const userId = await userIdOf(email)

    expect(response).toMatchObject({ ok: true, value: { signedIn: true } })
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
    expect(userId).toBeDefined()
    const { rows: members } = await harness
      .pool()
      .query(`SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`, [
        organization.id,
        userId,
      ])
    expect(members).toEqual([{ role: 'admin' }])
    const { rows: invitations } = await harness
      .pool()
      .query(`SELECT status FROM invitation WHERE id = $1`, [invitation.id])
    expect(invitations).toEqual([{ status: 'accepted' }])
  })

  it('refuses an address that already has an account, and signs nobody in', async () => {
    const { invitation, email } = await invitedPerson()
    await harness.seedVisitor({ email })

    const response = await harness.respondAs(
      null,
      () =>
        registerMember({
          data: {
            invitationId: invitation.id,
            name: 'New Manager',
            email,
            password: NEW_PASSWORD,
          },
        }),
      fromNewAddress(),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { status: 409, name: 'IdentityError', code: 'account_exists' },
    })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('answers a suspended Organization with the fixed copy and creates no account', async () => {
    const { invitation, email } = await invitedPerson(SUSPENDED_ORGANIZATION_ID)

    const response = await harness.respondAs(
      null,
      () =>
        registerMember({
          data: {
            invitationId: invitation.id,
            name: 'New Manager',
            email,
            password: NEW_PASSWORD,
          },
        }),
      fromNewAddress(),
    )

    expect(response).toMatchObject({
      ok: false,
      error: {
        status: 403,
        name: 'IdentityError',
        code: 'forbidden',
        message: INVITATION_PAUSED_MESSAGE,
      },
    })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await userIdOf(email)).toBeUndefined()
  })
})

describe('resendVerificationEmail', () => {
  it('answers sent for an unverified address', async () => {
    const member = await unverifiedMember()

    await expect(
      harness.callAs(
        null,
        () => resendVerificationEmail({ data: { email: member.email } }),
        fromNewAddress(),
      ),
    ).resolves.toEqual({ sent: true })
  })

  it('answers the same for an address with no account', async () => {
    await expect(
      harness.callAs(
        null,
        () => resendVerificationEmail({ data: { email: 'nobody@example.test' } }),
        fromNewAddress(),
      ),
    ).resolves.toEqual({ sent: true })
  })

  it('refuses a fourth request for one address with 429, even from other IPs', async () => {
    requireHarnessRedis(harness)
    const email = `limited.${randomUUID()}@example.test`
    for (let sent = 0; sent < 3; sent += 1) {
      await harness.callAs(
        null,
        () => resendVerificationEmail({ data: { email } }),
        fromNewAddress(),
      )
    }

    await expect(
      harness.callAs(
        null,
        () => resendVerificationEmail({ data: { email } }),
        fromNewAddress(),
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
  })

  it('refuses a sixth request from one IP with 429, whatever the address', async () => {
    requireHarnessRedis(harness)
    const request = fromNewAddress()
    for (let sent = 0; sent < 5; sent += 1) {
      await harness.callAs(
        null,
        () =>
          resendVerificationEmail({ data: { email: `a.${randomUUID()}@example.test` } }),
        request,
      )
    }

    await expect(
      harness.callAs(
        null,
        () =>
          resendVerificationEmail({ data: { email: `b.${randomUUID()}@example.test` } }),
        request,
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
  })

  it('keeps the address out of the limiter keys', async () => {
    const redis = requireHarnessRedis(harness)
    const email = `Pseudonym.${randomUUID()}@Example.test`

    await harness.callAs(
      null,
      () => resendVerificationEmail({ data: { email } }),
      fromNewAddress(),
    )

    const keys = await redis.keys('*verify-resend*')
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.join(' ').toLowerCase()).not.toContain('pseudonym')
  })
})

describe('listUserInvitations', () => {
  it('offers only the invitations that can still be accepted', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const person = await harness.seedVisitor()
    const offer = (options: { status?: 'pending' | 'canceled'; expiresAt?: Date }) =>
      harness.seedInvitation(organization, {
        inviter: admin,
        email: person.email,
        role: 'PropertyManager',
        ...options,
      })
    const live = await offer({ expiresAt: new Date(Date.now() + HOUR_MS) })
    await offer({ expiresAt: new Date(Date.now() - HOUR_MS) })
    await offer({ status: 'canceled', expiresAt: new Date(Date.now() + HOUR_MS) })

    const { invitations } = await harness.callAs(person, () => listUserInvitations())

    expect(invitations.map((invitation) => invitation.id)).toEqual([live.id])
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => listUserInvitations())).rejects.toMatchObject(
      {
        status: 401,
      },
    )
  })
})
