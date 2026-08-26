import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import { resetEnv } from '#/shared/config/env'
import { getPool } from '#/shared/db/pool'
import { createAuth } from './auth'
import { requireAuth } from './middleware'

const BASE_URL = 'http://localhost:3000'
const OLD_PASSWORD = 'old-password-123!'
const NEW_PASSWORD = 'new-password-456!'

type Auth = ReturnType<typeof createAuth>

let auth: Auth
let originalE2E: string | undefined

async function seedCredentialUser(label: string): Promise<{
  id: string
  email: string
}> {
  const id = `session-revocation-${randomUUID()}`
  const email = `${label}-${randomUUID()}@example.test`
  const password = await hashPassword(OLD_PASSWORD)
  await getPool().query(
    `INSERT INTO "user" (
       id, name, email, "emailVerified", image, "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, true, NULL, now(), now())`,
    [id, 'Session Revocation Test', email],
  )
  await getPool().query(
    `INSERT INTO account (
       id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
    [`account-${randomUUID()}`, id, password],
  )
  return { id, email }
}

async function cleanUser(id: string): Promise<void> {
  await getPool().query('DELETE FROM verification WHERE value = $1', [id])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [id])
}

async function authRequest(
  path: string,
  body: Readonly<Record<string, unknown>>,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: BASE_URL,
  })
  if (cookie) headers.set('cookie', cookie)
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/((?:__Secure-)?better-auth\.session_token)=([^;,]+)/)
  if (!match) {
    throw new Error(`Expected a session cookie, received: ${setCookie || '(none)'}`)
  }
  return `${match[1]}=${match[2]}`
}

async function signIn(
  email: string,
  password = OLD_PASSWORD,
): Promise<{
  response: Response
  cookie: string | null
}> {
  const response = await authRequest('/sign-in/email', { email, password })
  return {
    response,
    cookie: response.ok ? sessionCookie(response) : null,
  }
}

async function expectServerFunctionDenied(cookie: string): Promise<void> {
  await expect(requireAuth(new Headers({ cookie }))).rejects.toMatchObject({
    name: 'AuthError',
    code: 'unauthorized',
    status: 401,
  })
}

async function sessionCount(userId: string): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM session WHERE "userId" = $1',
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

beforeAll(() => {
  // The integration exercises revocation, not brute-force limiting. This is
  // the repository's guarded test-only hatch (NODE_ENV=test is the execution
  // identity), so no Redis availability or shared IP bucket can mask auth.
  originalE2E = process.env.E2E
  process.env.E2E = '1'
  resetEnv()
  auth = createAuth()
})

afterAll(() => {
  if (originalE2E === undefined) delete process.env.E2E
  else process.env.E2E = originalE2E
  resetEnv()
})

describe('password session revocation at the real auth/server-function boundary', () => {
  it('forces a password change to rotate the caller and revoke every older device', async () => {
    const user = await seedCredentialUser('change')
    try {
      const first = await signIn(user.email)
      const second = await signIn(user.email)
      expect(first.response.status).toBe(200)
      expect(second.response.status).toBe(200)
      expect(first.cookie).not.toBeNull()
      expect(second.cookie).not.toBeNull()
      expect(await sessionCount(user.id)).toBe(2)

      // A direct caller deliberately requests false. The server owns this
      // security policy and must not let a client preserve compromised peers.
      const changed = await authRequest(
        '/change-password',
        {
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
          revokeOtherSessions: false,
        },
        first.cookie!,
      )
      expect(changed.status).toBe(200)
      const rotated = sessionCookie(changed)

      await expectServerFunctionDenied(first.cookie!)
      await expectServerFunctionDenied(second.cookie!)
      await expect(requireAuth(new Headers({ cookie: rotated }))).resolves.toMatchObject({
        id: user.id,
      })
      expect(await sessionCount(user.id)).toBe(1)
    } finally {
      await cleanUser(user.id)
    }
  })

  it('password recovery revokes every device and only the new password can return', async () => {
    const user = await seedCredentialUser('reset')
    try {
      const first = await signIn(user.email)
      const second = await signIn(user.email)
      expect(first.cookie).not.toBeNull()
      expect(second.cookie).not.toBeNull()
      expect(await sessionCount(user.id)).toBe(2)

      const token = randomUUID()
      await getPool().query(
        `INSERT INTO verification (
           id, identifier, value, "expiresAt", "createdAt", "updatedAt"
         ) VALUES ($1, $2, $3, now() + interval '10 minutes', now(), now())`,
        [`verification-${randomUUID()}`, `reset-password:${token}`, user.id],
      )

      const reset = await authRequest('/reset-password', {
        token,
        newPassword: NEW_PASSWORD,
      })
      expect(reset.status).toBe(200)

      await expectServerFunctionDenied(first.cookie!)
      await expectServerFunctionDenied(second.cookie!)
      expect(await sessionCount(user.id)).toBe(0)

      const oldPassword = await signIn(user.email, OLD_PASSWORD)
      expect(oldPassword.response.status).toBe(401)
      expect(oldPassword.cookie).toBeNull()

      const recovered = await signIn(user.email, NEW_PASSWORD)
      expect(recovered.response.status).toBe(200)
      expect(recovered.cookie).not.toBeNull()
      await expect(
        requireAuth(new Headers({ cookie: recovered.cookie! })),
      ).resolves.toMatchObject({ id: user.id })
    } finally {
      await cleanUser(user.id)
    }
  })
})
