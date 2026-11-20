// Organizations, users, members and invitations for the server-function
// harness. Users sign in through Better Auth, as the app's sign-in does.

import { hashPassword } from 'better-auth/crypto'
import { getAuth } from '#/shared/auth/auth'
import type { Role } from '#/shared/domain/roles'
import { sessionCookie } from './server-function-request'
import type { HarnessSeedContext } from './server-function-seed-context'

const BETTER_AUTH_ROLE: Readonly<Record<Role, string>> = {
  AccountAdmin: 'owner',
  PropertyManager: 'admin',
  Member: 'member',
}

const PASSWORD = 'harness-password-123!'

export type TestOrganization = Readonly<{ id: string }>

/** A signed-in user. */
export type TestUser = Readonly<{
  userId: string
  email: string
  /** The password the user signs in with. */
  password: string
  /** The session cookie the user's requests carry. */
  cookie: string
}>

export type TestMember = TestUser &
  Readonly<{
    /** The `member` row's id. */
    memberId: string
    organizationId: string
    role: Role
  }>

export type SeedOrganizationOptions = Readonly<{ id?: string; name?: string }>

export type SeedUserOptions = Readonly<{
  userId?: string
  email?: string
  name?: string
  /** Defaults to true. */
  emailVerified?: boolean
}>

export type SeedInvitationOptions = Readonly<{
  email?: string
  role?: Role
  status?: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt?: Date
  propertyIds?: readonly string[]
  inviter: TestMember
}>

export type TestInvitation = Readonly<{
  id: string
  organizationId: string
  email: string
}>

export type IdentitySeeds = Readonly<{
  seedOrganization: (options?: SeedOrganizationOptions) => Promise<TestOrganization>
  /** A user who is a member of the Organization in this role, signed in to it. */
  seedMember: (
    organization: TestOrganization,
    role: Role,
    options?: SeedUserOptions,
  ) => Promise<TestMember>
  /** A signed-in user who belongs to no Organization. */
  seedVisitor: (options?: SeedUserOptions) => Promise<TestUser>
  seedInvitation: (
    organization: TestOrganization,
    options: SeedInvitationOptions,
  ) => Promise<TestInvitation>
}>

export function identitySeeds(context: HarnessSeedContext): IdentitySeeds {
  const { pool } = context

  const signIn = async (email: string): Promise<string> => {
    const signedIn = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      headers: new Headers(),
      returnHeaders: true,
    })
    return sessionCookie(signedIn.headers)
  }

  const insertUser = async (options: SeedUserOptions) => {
    const userId = options.userId ?? `user-harness-${context.newId()}`
    const email = options.email ?? `${userId}@example.test`
    context.trackUser(userId)
    await pool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [userId, options.name ?? 'Harness Member', email, options.emailVerified ?? true],
    )
    await pool().query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
      [`account-${userId}`, userId, await hashPassword(PASSWORD)],
    )
    return { userId, email }
  }

  return {
    seedOrganization: async (options = {}) => {
      const id = options.id ?? `org-harness-${context.newId()}`
      context.trackOrganization(id)
      await pool().query(
        `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())`,
        [id, options.name ?? 'Harness Hotels', `h-${id.replace(/-/g, '')}`],
      )
      return { id }
    },

    seedMember: async (organization, role, options = {}) => {
      const { userId, email } = await insertUser(options)
      const memberId = `member-${userId}`
      await pool().query(
        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
         VALUES ($1, $2, $3, $4, NOW())`,
        [memberId, organization.id, userId, BETTER_AUTH_ROLE[role]],
      )
      const cookie = await signIn(email)
      await getAuth().api.setActiveOrganization({
        headers: new Headers({ cookie }),
        body: { organizationId: organization.id },
      })
      return {
        userId,
        memberId,
        organizationId: organization.id,
        role,
        email,
        password: PASSWORD,
        cookie,
      }
    },

    seedVisitor: async (options = {}) => {
      const { userId, email } = await insertUser(options)
      return { userId, email, password: PASSWORD, cookie: await signIn(email) }
    },

    seedInvitation: async (organization, options) => {
      const id = `invitation-harness-${context.newId()}`
      const email = options.email ?? `${id}@example.test`
      const propertyIds = options.propertyIds ?? []
      await pool().query(
        `INSERT INTO invitation
           (id, "organizationId", email, role, status, "expiresAt", "propertyIds",
            "inviterId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          organization.id,
          email,
          BETTER_AUTH_ROLE[options.role ?? 'PropertyManager'],
          options.status ?? 'pending',
          options.expiresAt ?? new Date(context.clock().getTime() + 86_400_000),
          propertyIds.length > 0 ? JSON.stringify(propertyIds) : null,
          options.inviter.userId,
          context.clock(),
        ],
      )
      return { id, organizationId: organization.id, email }
    },
  }
}
