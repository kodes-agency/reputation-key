// A staff member's own account actions, called as a signed-in member over
// PostgreSQL and the test Redis with the real staff resolver, execution policy,
// Better Auth and abuse budgets. Only Sentry, the monitoring provider, is a fake.

import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { betaFeedbackPseudonym } from '#/contexts/identity/application/beta-feedback-pseudonym'
import type { BetaFeedbackInput } from '#/shared/beta-feedback-contract'
import { getAuth } from '#/shared/auth/auth'
import { getEnv } from '#/shared/config/env'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'
import { requireHarnessRedis } from '#/shared/testing/server-function-require-redis'
import { sessionCookie } from '#/shared/testing/server-function-request'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

const capture = vi.hoisted(() => ({ feedback: vi.fn() }))

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
vi.mock('#/shared/observability/telemetry', async (importActual) => ({
  ...(await importActual<typeof import('#/shared/observability/telemetry')>()),
  captureObservabilityFeedback: capture.feedback,
}))

import {
  changeMyStaffPassword,
  listMyStaffFeedback,
  submitMyStaffFeedback,
} from './staff-self-account'
import { getMyStaffHome } from './staff-self'

const SUSPENDED_ORGANIZATION_ID = `org-suspended-${randomUUID()}`
const NEXT_PASSWORD = 'NextPassword123!'
const PASSWORD_FAILURES_PER_HOUR = 10
const STAFF_REPORTS_PER_HOUR = 2

const pseudonym = (userId: string) =>
  betaFeedbackPseudonym(getEnv().BETTER_AUTH_SECRET, 'telemetry-actor', userId)

const harness = setupServerFunctionHarness({
  redis: true,
  env: { BETA_SUSPENDED_ORGS: SUSPENDED_ORGANIZATION_ID },
  cleanupTables: PORTAL_SEED_CLEANUP_TABLES,
  afterPropertiesCleanup: async (client, { userIds }) => {
    await client.query(
      `DELETE FROM beta_feedback_triage WHERE actor_pseudonym = ANY($1)`,
      [userIds.map(pseudonym)],
    )
  },
})

const report: BetaFeedbackInput = {
  kind: 'bug',
  impact: 'cannot_complete',
  clientErrorEventId: null,
  maskedLayout: null,
  screenshot: null,
  message: 'The code did not draw.',
  routePath: '/staff',
  viewport: 'compact',
}

async function staffMember(organizationId?: string) {
  capture.feedback.mockReset()
  capture.feedback.mockImplementation(() => randomBytes(16).toString('hex'))
  const organization = organizationId
    ? await harness.seedOrganization({ id: organizationId })
    : await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const staff = await harness.seedMember(organization, 'Member')
  const participation = await harness.seedStaffParticipation(staff, property)
  return { organization, property, staff, participation }
}

const changePassword = (staff: TestMember, currentPassword: string) =>
  harness.callAs(staff, () =>
    changeMyStaffPassword({ data: { currentPassword, newPassword: NEXT_PASSWORD } }),
  )

/** A fresh session: changing the password ends every earlier one. */
async function signedInAgain(staff: TestMember, password: string) {
  const signedIn = await getAuth().api.signInEmail({
    body: { email: staff.email, password },
    headers: new Headers(),
    returnHeaders: true,
  })
  const cookie = sessionCookie(signedIn.headers)
  await getAuth().api.setActiveOrganization({
    headers: new Headers({ cookie }),
    body: { organizationId: staff.organizationId },
  })
  return { ...staff, cookie }
}

async function signsInWith(staff: TestMember, password: string) {
  try {
    await getAuth().api.signInEmail({
      body: { email: staff.email, password },
      headers: new Headers(),
    })
    return true
  } catch {
    return false
  }
}

async function triageCount(staff: TestMember) {
  const { rows } = await harness
    .pool()
    .query(
      `SELECT count(*)::int AS n FROM beta_feedback_triage WHERE actor_pseudonym = $1`,
      [pseudonym(staff.userId)],
    )
  return rows[0].n as number
}

describe('changeMyStaffPassword', () => {
  it('changes the password and ends the member’s other sessions', async () => {
    const { staff } = await staffMember()
    const otherSession = await signedInAgain(staff, staff.password)
    await harness.callAs(otherSession, () => getMyStaffHome())

    await changePassword(staff, staff.password)

    expect(await signsInWith(staff, NEXT_PASSWORD)).toBe(true)
    expect(await signsInWith(staff, staff.password)).toBe(false)
    await expect(
      harness.callAs(otherSession, () => getMyStaffHome()),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a wrong current password and keeps the password', async () => {
    const { staff } = await staffMember()

    await expect(changePassword(staff, 'not-the-password-1')).rejects.toMatchObject({
      code: 'password_change_failed',
    })

    expect(await signsInWith(staff, staff.password)).toBe(true)
  })

  it('counts only failed attempts, and refuses after ten in an hour', async () => {
    requireHarnessRedis(harness)
    const { staff } = await staffMember()
    await changePassword(staff, staff.password)
    const current = await signedInAgain(staff, NEXT_PASSWORD)
    for (let attempt = 0; attempt < PASSWORD_FAILURES_PER_HOUR; attempt += 1) {
      await expect(changePassword(current, 'not-the-password-1')).rejects.toMatchObject({
        code: 'password_change_failed',
      })
    }

    await expect(changePassword(current, NEXT_PASSWORD)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })

    expect(await signsInWith(staff, NEXT_PASSWORD)).toBe(true)
  })

  it('does not spend one person’s failures on another', async () => {
    requireHarnessRedis(harness)
    const { staff } = await staffMember()
    const { staff: colleague } = await staffMember()
    for (let attempt = 0; attempt < PASSWORD_FAILURES_PER_HOUR; attempt += 1) {
      await changePassword(staff, 'not-the-password-1').catch(() => undefined)
    }

    await changePassword(colleague, colleague.password)

    expect(await signsInWith(colleague, NEXT_PASSWORD)).toBe(true)
  })

  it('refuses a member with no staff link and changes nothing', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')

    await expect(changePassword(member, member.password)).rejects.toMatchObject({
      code: 'forbidden',
    })

    expect(await signsInWith(member, member.password)).toBe(true)
  })

  it('refuses a person whose participation has ended', async () => {
    const { staff, participation } = await staffMember()
    await harness.pool().query(
      `UPDATE staff_participations
          SET status = 'archived', ended_at = now(), archive_reason = 'harness'
        WHERE id = $1`,
      [participation.participationId],
    )

    await expect(changePassword(staff, staff.password)).rejects.toMatchObject({
      code: 'forbidden',
    })

    expect(await signsInWith(staff, staff.password)).toBe(true)
  })

  it('refuses a staff member of a suspended Organization and changes nothing', async () => {
    const { staff } = await staffMember(SUSPENDED_ORGANIZATION_ID)

    await expect(changePassword(staff, staff.password)).rejects.toMatchObject({
      status: 403,
    })

    expect(await signsInWith(staff, staff.password)).toBe(true)
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () =>
        changeMyStaffPassword({
          data: { currentPassword: 'x', newPassword: NEXT_PASSWORD },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('submitMyStaffFeedback', () => {
  it('records the report as the signed-in person and returns its reference', async () => {
    const { staff } = await staffMember()

    const receipt = await harness.callAs(staff, () =>
      submitMyStaffFeedback({ data: report }),
    )

    expect(receipt).toEqual({ reference: expect.any(String) })
    expect(capture.feedback).toHaveBeenCalledTimes(1)
    const { rows } = await harness.pool().query(
      `SELECT reference, reporter_role, delivery_state FROM beta_feedback_triage
          WHERE actor_pseudonym = $1`,
      [pseudonym(staff.userId)],
    )
    expect(rows).toEqual([
      {
        reference: receipt.reference,
        reporter_role: 'Member',
        delivery_state: 'delivered',
      },
    ])
  })

  it('refuses a third report in an hour on the separate staff budget, recording nothing', async () => {
    requireHarnessRedis(harness)
    const { staff } = await staffMember()
    for (let sent = 0; sent < STAFF_REPORTS_PER_HOUR; sent += 1) {
      await harness.callAs(staff, () => submitMyStaffFeedback({ data: report }))
    }
    capture.feedback.mockClear()

    await expect(
      harness.callAs(staff, () => submitMyStaffFeedback({ data: report })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    expect(capture.feedback).not.toHaveBeenCalled()
    expect(await triageCount(staff)).toBe(STAFF_REPORTS_PER_HOUR)
  })

  it('refuses a person whose participation has ended and records nothing', async () => {
    const { staff, participation } = await staffMember()
    await harness.pool().query(
      `UPDATE staff_participations
          SET status = 'archived', ended_at = now(), archive_reason = 'harness'
        WHERE id = $1`,
      [participation.participationId],
    )

    await expect(
      harness.callAs(staff, () => submitMyStaffFeedback({ data: report })),
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(capture.feedback).not.toHaveBeenCalled()
    expect(await triageCount(staff)).toBe(0)
  })
})

describe('listMyStaffFeedback', () => {
  it('lists only the caller’s own reports, marked uncacheable', async () => {
    const { staff, property, organization } = await staffMember()
    const colleague = await harness.seedMember(organization, 'Member')
    await harness.seedStaffParticipation(colleague, property, {
      displayName: 'Colleague',
    })
    const mine = await harness.callAs(staff, () =>
      submitMyStaffFeedback({ data: report }),
    )
    await harness.callAs(colleague, () => submitMyStaffFeedback({ data: report }))

    const response = await harness.respondAs(staff, () => listMyStaffFeedback())

    expect(response.ok).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    if (!response.ok) return
    expect(response.value.map((entry) => entry.reference)).toEqual([mine.reference])
  })

  it('lists nothing for a person who has sent nothing', async () => {
    const { staff } = await staffMember()

    expect(await harness.callAs(staff, () => listMyStaffFeedback())).toEqual([])
  })

  it('refuses a member with no staff link', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => listMyStaffFeedback()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
