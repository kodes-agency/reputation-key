// The Better Auth 1.7.5 behaviours invitation registration relies on (ADR
// 0062), pinned against the real provider and database with email
// verification required, as production runs:
//   - an unverified address is refused at sign-in with EMAIL_NOT_VERIFIED,
//     after the password check;
//   - a password reset verifies the address, and a failure to verify never
//     stops it revoking the user's sessions;
//   - sign-up opens no session and mails nothing;
//   - sign-up for an existing address answers with a synthetic user that is
//     never written — which is why registration refuses that address first.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import { resetEnv } from '#/shared/config/env'
import { getPool } from '#/shared/db/pool'
import { createAuth } from './auth'

const BASE_URL = 'http://localhost:3000'
const PASSWORD = 'invited-sign-up-123!'
const NEW_PASSWORD = 'invited-reset-456!'
const PREFIX = 'invited-sign-up-contract-'

type Auth = ReturnType<typeof createAuth>

let auth: Auth
let originalE2E: string | undefined
let originalVerification: string | undefined

async function seedUser(
  options: Readonly<{ emailVerified: boolean }>,
): Promise<{ id: string; email: string }> {
  const id = `${PREFIX}${randomUUID()}`
  const email = `${id}@example.test`
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
     VALUES ($1, 'Invited Sign-up Test', $2, $3, NULL, now(), now())`,
    [id, email, options.emailVerified],
  )
  await getPool().query(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
    [`account-${randomUUID()}`, id, await hashPassword(PASSWORD)],
  )
  return { id, email }
}

async function signIn(email: string, password = PASSWORD): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', origin: BASE_URL }),
      body: JSON.stringify({ email, password }),
    }),
  )
}

/** A reset token as Better Auth stores the one it mails. */
async function seedResetToken(userId: string): Promise<string> {
  const token = randomUUID()
  await getPool().query(
    `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, now() + interval '10 minutes', now(), now())`,
    [`verification-${randomUUID()}`, `reset-password:${token}`, userId],
  )
  return token
}

/** A live session the reset must revoke — a stolen one, as far as it knows. */
async function seedSession(userId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO session (id, "expiresAt", token, "userId", "createdAt", "updatedAt")
     VALUES ($1, now() + interval '1 hour', $2, $3, now(), now())`,
    [`session-${randomUUID()}`, `token-${randomUUID()}`, userId],
  )
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await getPool().query('SELECT id FROM session WHERE "userId" = $1', [
    userId,
  ])
  return rows.rows.length
}

async function emailVerified(id: string): Promise<boolean | null> {
  const rows = await getPool().query<{ emailVerified: boolean }>(
    'SELECT "emailVerified" FROM "user" WHERE id = $1',
    [id],
  )
  return rows.rows[0]?.emailVerified ?? null
}

beforeAll(() => {
  originalE2E = process.env.E2E
  originalVerification = process.env.EMAIL_VERIFICATION_REQUIRED
  // The guarded test-only limiter hatch, as session-revocation uses it.
  process.env.E2E = '1'
  process.env.EMAIL_VERIFICATION_REQUIRED = 'true'
  resetEnv()
  auth = createAuth()
})

afterAll(async () => {
  await getPool().query(`DELETE FROM verification WHERE value LIKE '${PREFIX}%'`)
  await getPool().query(`DELETE FROM "user" WHERE email LIKE '${PREFIX}%'`)
  if (originalE2E === undefined) delete process.env.E2E
  else process.env.E2E = originalE2E
  if (originalVerification === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED
  else process.env.EMAIL_VERIFICATION_REQUIRED = originalVerification
  resetEnv()
})

describe('Better Auth behaviour behind invitation registration', () => {
  it('refuses an unverified address at sign-in with EMAIL_NOT_VERIFIED', async () => {
    const user = await seedUser({ emailVerified: false })

    const refused = await signIn(user.email)

    expect(refused.status).toBe(403)
    await expect(refused.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
    const wrongPassword = await signIn(user.email, 'not-the-password-1!')
    expect(wrongPassword.status).toBe(401)
  })

  it('verifies the address when a password reset consumes the mailed token', async () => {
    const user = await seedUser({ emailVerified: false })
    const token = await seedResetToken(user.id)

    await auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } })

    expect(await emailVerified(user.id)).toBe(true)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('still revokes every session when the verification write fails', async () => {
    // onPasswordReset runs between the password update and the session
    // revocation. Verification is best-effort; revocation is the guarantee.
    const user = await seedUser({ emailVerified: false })
    const token = await seedResetToken(user.id)
    await seedSession(user.id)
    expect(await sessionCount(user.id)).toBe(1)
    const pool = getPool()
    const passThrough = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>
    const failVerification = vi
      .spyOn(pool, 'query')
      .mockImplementation(((...args: unknown[]) =>
        typeof args[0] === 'string' &&
        args[0].startsWith('UPDATE "user" SET "emailVerified"')
          ? Promise.reject(new Error('canceling statement due to statement timeout'))
          : passThrough(...args)) as never)

    try {
      await expect(
        auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } }),
      ).resolves.toEqual({ status: true })
      expect(failVerification).toHaveBeenCalledWith(
        expect.stringMatching(/^UPDATE "user" SET "emailVerified"/),
        [user.id],
      )
    } finally {
      failVerification.mockRestore()
    }

    expect(await sessionCount(user.id)).toBe(0)
    expect(await emailVerified(user.id)).toBe(false)
  })

  it('creates the user with no session and no verification mail', async () => {
    const email = `${PREFIX}${randomUUID()}@example.test`

    const created = await auth.api.signUpEmail({
      body: { name: 'New Manager', email, password: PASSWORD },
    })

    expect(created.token).toBeNull()
    const sessions = await getPool().query('SELECT id FROM session WHERE "userId" = $1', [
      created.user.id,
    ])
    expect(sessions.rows).toEqual([])
    expect(await emailVerified(created.user.id)).toBe(false)
  })

  it('answers a sign-up for an existing address with a user it never writes', async () => {
    const existing = await seedUser({ emailVerified: true })

    const synthetic = await auth.api.signUpEmail({
      body: { name: 'Someone Else', email: existing.email, password: PASSWORD },
    })

    expect(synthetic.token).toBeNull()
    expect(synthetic.user.id).not.toBe(existing.id)
    expect(await emailVerified(synthetic.user.id)).toBeNull()
  })
})
