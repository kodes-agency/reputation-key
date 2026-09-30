// The e2e seed's credential users: a Better Auth sign-up (the same path an
// account takes in the app), then a verified email and a known password on
// every run so a reseed never locks a spec out.
//
// A caller may fix a new user's id. e2e/stack.env lists the seeded owner as
// the platform operator by account (`user:<id>`, ADR 0063), so that id must be
// known before the stack starts.

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { getAuth } from '../../src/shared/auth/auth'
import { runWithRegistrationAuthIds } from '../../src/shared/auth/registration-user-id'
import { getDb } from '../../src/shared/db'
import { account, user } from '../../src/shared/db/schema/auth'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
} from '../../src/contexts/identity/infrastructure/adapters/better-auth-schemas'

export type CredentialUser = Readonly<{
  email: string
  password: string
  name: string
  /** A fixed id for a new user; an existing user keeps the id it has. */
  userId?: string
}>

/** Better Auth sign-up, under a fixed user id when the caller names one. */
async function signUpCredentialUser(input: CredentialUser): Promise<string> {
  const signUp = () =>
    getAuth().api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
    })
  const response = input.userId
    ? await runWithRegistrationAuthIds(
        {
          userId: input.userId,
          credentialAccountId: randomUUID(),
          initialSessionId: randomUUID(),
        },
        signUp,
      )
    : await signUp()
  return parseBetterAuthResponse(
    signUpResponseSchema,
    response,
    'registration_failed',
    `Could not create E2E user ${input.email}`,
  ).user.id
}

/** The user's id: found by email, or created by a Better Auth sign-up. */
export async function ensureCredentialUser(input: CredentialUser): Promise<string> {
  const db = getDb()
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  let userId = existing?.id
  if (userId && input.userId && userId !== input.userId) {
    console.warn(
      `E2E user ${input.email} predates its fixed id ${input.userId}; ` +
        'reseed an empty database for anything keyed by that id (the operator console).',
    )
  }
  if (!userId) {
    userId = await signUpCredentialUser(input)
  }

  await db
    .update(user)
    .set({ name: input.name, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId))
  const [credential] = await db
    .update(account)
    .set({ password: await hashPassword(input.password), updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .returning({ id: account.id })
  if (!credential) throw new Error(`Credential account missing for ${input.email}`)
  return userId
}
