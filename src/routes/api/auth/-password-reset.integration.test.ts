// A password reset request through /api/auth/*, against the real provider
// (Better Auth 1.7.5) and a real database, with the route's limiter ON.
//
// The colocated unit test proves which keys the route counts. This suite
// proves what the provider does with the request the route hands it:
//   - the route reads the address from a clone, and the provider still reads
//     the body and mails the account;
//   - the reply is the same for an address with an account and one without,
//     and does not wait for the mail provider;
//   - a request the route refuses for its address leaves no reset token.

import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import { resetEnv } from '#/shared/config/env'
import { getPool } from '#/shared/db/pool'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  // The mail provider never answers: a reply that waits for it never comes.
  sendResetPasswordEmail: vi.fn(() => new Promise<void>(() => {})),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    rateLimiter: { check: mocks.check },
    identityRequestSecurity: { invitationRateLimitHmacSecret: 'reset-suite-secret' },
  }),
}))
vi.mock('#/shared/auth/emails', () => ({
  sendResetPasswordEmail: mocks.sendResetPasswordEmail,
  sendVerificationEmail: vi.fn(),
}))

import { handleAuthRequest } from './$'

const BASE_URL = 'http://localhost:3000'
const PREFIX = 'resetroute-'
const ADDRESS_KEY = /^identity:password-reset:email:[a-f0-9]{64}$/
/** Longer than any local round trip, far shorter than a hung test. */
const PATIENCE_MS = 4_000

let originalE2E: string | undefined
let member: Readonly<{ id: string; email: string }>

/**
 * The provider keeps its own limit for this path (3 a minute per client
 * address), in Redis when one answers, so it outlives a run. Every request
 * here comes from an address of its own: this suite is about the route's
 * limit, and a second run within the minute must not meet the provider's.
 */
const clientAddress = () =>
  `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`

async function resetRequest(email: string): Promise<Response | 'no reply'> {
  let giveUp: ReturnType<typeof setTimeout> | undefined
  const noReply = new Promise<'no reply'>((resolve) => {
    giveUp = setTimeout(() => resolve('no reply'), PATIENCE_MS)
  })
  const reply = handleAuthRequest(
    new Request(`${BASE_URL}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: {
        origin: BASE_URL,
        'content-type': 'application/json',
        'x-forwarded-for': clientAddress(),
      },
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    }),
    { rateLimit: true },
  )
  const outcome = await Promise.race([reply, noReply])
  clearTimeout(giveUp)
  return outcome
}

async function resetTokenCount(userId: string): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    `SELECT count(*) AS count FROM verification
      WHERE identifier LIKE 'reset-password:%' AND value = $1`,
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function cleanup(): Promise<void> {
  await getPool().query(
    `DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE id LIKE $1)`,
    [`${PREFIX}%`],
  )
  await getPool().query(`DELETE FROM "user" WHERE id LIKE $1`, [`${PREFIX}%`])
}

beforeAll(async () => {
  // The limiter is under test here, so the e2e stand-down must be off.
  originalE2E = process.env.E2E
  delete process.env.E2E
  resetEnv()

  await cleanup()
  const id = `${PREFIX}${randomUUID()}`
  member = { id, email: `${id}@example.test` }
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
     VALUES ($1, 'Reset Route Test', $2, true, NULL, now(), now())`,
    [member.id, member.email],
  )
  await getPool().query(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
    [
      `${PREFIX}account-${randomUUID()}`,
      member.id,
      await hashPassword('reset-route-123!'),
    ],
  )
})

afterAll(async () => {
  await cleanup()
  if (originalE2E === undefined) delete process.env.E2E
  else process.env.E2E = originalE2E
  resetEnv()
})

beforeEach(() => {
  mocks.check.mockReset()
  mocks.check.mockResolvedValue({ allowed: true })
  mocks.sendResetPasswordEmail.mockClear()
})

describe('a password reset request at the /api/auth boundary, real provider and database', () => {
  it('mails the account and replies without waiting for the mail provider', async () => {
    const reply = await resetRequest(member.email)

    expect(reply).toBeInstanceOf(Response)
    expect((reply as Response).status).toBe(200)
    await expect((reply as Response).json()).resolves.toMatchObject({ status: true })
    // The provider read the body the route had already read from a clone.
    expect(mocks.sendResetPasswordEmail).toHaveBeenCalledTimes(1)
    const [to, url] = mocks.sendResetPasswordEmail.mock.calls[0] as unknown as [
      string,
      string,
    ]
    expect(to).toBe(member.email)
    expect(url).toContain('/api/auth/reset-password/')
    expect(await resetTokenCount(member.id)).toBe(1)
    // Counted per IP, then per address.
    expect(mocks.check.mock.calls[1]?.[0]).toMatch(ADDRESS_KEY)
  })

  it('gives an address with no account the same reply, and mails nobody', async () => {
    const reply = await resetRequest(`${PREFIX}stranger-${randomUUID()}@example.test`)

    expect((reply as Response).status).toBe(200)
    await expect((reply as Response).json()).resolves.toMatchObject({ status: true })
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
    expect(mocks.check.mock.calls[1]?.[0]).toMatch(ADDRESS_KEY)
  })

  it('refuses an address over its limit before the provider issues a token', async () => {
    const before = await resetTokenCount(member.id)
    mocks.check.mockImplementation(async (key: string) => ({
      allowed: !ADDRESS_KEY.test(key),
    }))

    const reply = await resetRequest(member.email)

    expect((reply as Response).status).toBe(429)
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
    expect(await resetTokenCount(member.id)).toBe(before)
  })
})
