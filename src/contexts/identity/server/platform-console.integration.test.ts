// The platform operator console's server functions, called as signed-in users
// over PostgreSQL and the test Redis: who may use the console, the recent
// sign-in a change needs, the hourly change budget, and what each change leaves.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestUser,
} from '#/shared/testing/server-function-harness'
import { requireHarnessRedis } from '#/shared/testing/server-function-require-redis'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  cancelOrganizationAdminInvitationFn,
  inviteOrganizationAdminFn,
  provisionOrganizationFn,
  resendOrganizationAdminInvitationFn,
} from './platform-console-changes'
import { listPlatformOrganizationsFn } from './platform-console'

const OPERATOR_USER_ID = `operator-${randomUUID()}`
const CHANGE_BUDGET = 30

const harness = setupServerFunctionHarness({
  env: { OPS_OPERATOR_IDENTITIES: `user:${OPERATOR_USER_ID}` },
  redis: true,
})

const ADMIN_EMAIL = 'admin@riviera.example'

async function operator() {
  return harness.seedVisitor({ userId: OPERATOR_USER_ID, name: 'Bo Operator' })
}

async function signedInAgo(user: TestUser, minutes: number) {
  await harness
    .pool()
    .query(
      `UPDATE session SET "createdAt" = now() - make_interval(mins => $2) WHERE "userId" = $1`,
      [user.userId, minutes],
    )
}

async function provision(op: TestUser, name = 'Hotel Riviera') {
  const result = await harness.callAs(op, () =>
    provisionOrganizationFn({ data: { name, adminEmail: ADMIN_EMAIL } }),
  )
  harness.trackOrganization(result.organizationId)
  return result
}

async function organizationCount(name: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT count(*)::int AS n FROM organization WHERE name = $1`, [name])
  return rows[0].n as number
}

async function invitationStatus(invitationId: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT status FROM invitation WHERE id = $1`, [invitationId])
  return rows[0]?.status as string | undefined
}

describe('listPlatformOrganizationsFn', () => {
  it('lists the Organizations to an operator on a session of any age, kept out of every cache', async () => {
    const op = await operator()
    const organization = await harness.seedOrganization()
    await signedInAgo(op, 5 * 60)

    const response = await harness.respondAs(op, () => listPlatformOrganizationsFn())

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value.map((view) => view.id)).toContain(organization.id)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(response.headers.get('vary')).toContain('Cookie')
  })

  it('refuses a signed-in user who is not a registered operator', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(admin, () => listPlatformOrganizationsFn()),
    ).rejects.toMatchObject({ code: 'operator_not_registered', status: 403 })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => listPlatformOrganizationsFn()),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('provisionOrganizationFn', () => {
  it('creates the Organization and its first admin invitation, and mails it', async () => {
    const op = await operator()

    const result = await provision(op)

    expect(result).toMatchObject({
      organizationId: expect.any(String),
      slug: expect.any(String),
      invitationId: expect.any(String),
      emailSent: true,
    })
    expect(await invitationStatus(result.invitationId)).toBe('pending')
    expect(
      harness
        .fakes()
        .email.captured()
        .map((mail) => mail.email),
    ).toContain(ADMIN_EMAIL)
    const listed = await harness.callAs(op, () => listPlatformOrganizationsFn())
    expect(listed.map((view) => view.id)).toContain(result.organizationId)
  })

  it('refuses a session signed in more than 30 minutes ago and creates nothing', async () => {
    const op = await operator()
    await signedInAgo(op, 31)

    await expect(
      harness.callAs(op, () =>
        provisionOrganizationFn({
          data: { name: 'Stale Session Hotel', adminEmail: ADMIN_EMAIL },
        }),
      ),
    ).rejects.toMatchObject({ code: 'operator_reauth_required', status: 403 })
    expect(await organizationCount('Stale Session Hotel')).toBe(0)
  })

  it('refuses a user who is not an operator and creates nothing', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(admin, () =>
        provisionOrganizationFn({
          data: { name: 'Not An Operator Hotel', adminEmail: ADMIN_EMAIL },
        }),
      ),
    ).rejects.toMatchObject({ code: 'operator_not_registered', status: 403 })
    expect(await organizationCount('Not An Operator Hotel')).toBe(0)
    expect(harness.fakes().email.captured()).toEqual([])
  })

  it('refuses a slug a seeded Organization already holds', async () => {
    const op = await operator()
    const { rows } = await harness
      .pool()
      .query(`SELECT slug FROM organization WHERE id = $1`, [
        (await harness.seedOrganization()).id,
      ])

    await expect(
      harness.callAs(op, () =>
        provisionOrganizationFn({
          data: { name: 'Slug Clash Hotel', slug: rows[0].slug, adminEmail: ADMIN_EMAIL },
        }),
      ),
    ).rejects.toMatchObject({ code: 'already_exists', status: 409 })
    expect(await organizationCount('Slug Clash Hotel')).toBe(0)
  })

  it('refuses input the validator rejects', async () => {
    const op = await operator()

    await expect(
      harness.callAs(op, () =>
        provisionOrganizationFn({ data: { name: 'X', adminEmail: 'not-an-address' } }),
      ),
    ).rejects.toThrow(/adminEmail/)
    expect(await organizationCount('X')).toBe(0)
  })
})

describe('invite, resend and cancel', () => {
  it('invites a second admin to an Organization that has none', async () => {
    const op = await operator()
    const { organizationId } = await provision(op)

    const invited = await harness.callAs(op, () =>
      inviteOrganizationAdminFn({
        data: { organizationId, email: 'second@riviera.example' },
      }),
    )

    expect(invited).toMatchObject({ invitationId: expect.any(String), emailSent: true })
    expect(await invitationStatus(invited.invitationId)).toBe('pending')
  })

  it('resends an open invitation with a new expiry', async () => {
    const op = await operator()
    const { organizationId, invitationId } = await provision(op)

    const resent = await harness.callAs(op, () =>
      resendOrganizationAdminInvitationFn({ data: { organizationId, invitationId } }),
    )

    expect(resent).toMatchObject({ expiresAt: expect.any(String), emailSent: true })
  })

  it('cancels an open invitation', async () => {
    const op = await operator()
    const { organizationId, invitationId } = await provision(op)

    const cancelled = await harness.callAs(op, () =>
      cancelOrganizationAdminInvitationFn({ data: { organizationId, invitationId } }),
    )

    expect(cancelled).toBeUndefined()
    expect(await invitationStatus(invitationId)).toBe('canceled')
  })

  it('answers invitation_not_found for an invitation the Organization does not hold', async () => {
    const op = await operator()
    const { organizationId } = await provision(op)

    await expect(
      harness.callAs(op, () =>
        resendOrganizationAdminInvitationFn({
          data: { organizationId, invitationId: 'no-such-invitation' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'invitation_not_found', status: 404 })
  })

  it('refuses to invite an admin to an Organization that already has one', async () => {
    const op = await operator()
    const organization = await harness.seedOrganization()
    await harness.seedMember(organization, 'AccountAdmin')

    await expect(
      harness.callAs(op, () =>
        inviteOrganizationAdminFn({
          data: { organizationId: organization.id, email: ADMIN_EMAIL },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })
})

describe('the change budget', () => {
  const spendChange = (op: TestUser) =>
    harness.respondAs(op, () =>
      cancelOrganizationAdminInvitationFn({
        data: { organizationId: 'no-such-organization', invitationId: 'none' },
      }),
    )

  it('refuses the change after the hourly budget is spent, and changes nothing', async () => {
    requireHarnessRedis(harness)
    const op = await operator()
    const { organizationId, invitationId } = await provision(op)
    for (let spent = 1; spent < CHANGE_BUDGET; spent += 1) await spendChange(op)

    await expect(
      harness.callAs(op, () =>
        cancelOrganizationAdminInvitationFn({ data: { organizationId, invitationId } }),
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
    expect(await invitationStatus(invitationId)).toBe('pending')
  })

  it('does not draw on the budget for a read or a non-operator attempt', async () => {
    requireHarnessRedis(harness)
    const op = await operator()
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    for (let attempt = 0; attempt <= CHANGE_BUDGET; attempt += 1) {
      await harness.respondAs(admin, () =>
        provisionOrganizationFn({
          data: { name: 'Refused Hotel', adminEmail: ADMIN_EMAIL },
        }),
      )
      await harness.respondAs(op, () => listPlatformOrganizationsFn())
    }

    const response = await spendChange(op)

    expect(response).toMatchObject({
      ok: false,
      error: { code: expect.not.stringMatching('rate_limited') },
    })
  })
})
