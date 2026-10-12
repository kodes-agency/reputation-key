// What a signed-in account can reach through /api/auth/*, against the real
// provider (Better Auth 1.7.5) and a real database.
//
// The colocated unit test proves which requests the route hands to the
// provider. This suite proves what that means: the provider answers its own
// organization routes with checks the app does not accept as authorization.
//   - Any member of an Organization reads every invitation row, ids included,
//     and an invitation id plus the invited address is all invited
//     registration asks for.
//   - Any signed-in account creates an Organization and becomes its owner.
//   - An AccountAdmin updates the Organization with none of the app's checks.
// Each case goes through the route's own handler, so it fails if a refused
// provider route becomes reachable again.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashPassword } from 'better-auth/crypto'
import { getAuth } from '#/shared/auth/auth'
import { resetEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { getPool } from '#/shared/db/pool'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

// The route reads its limiter from the application container. The limiter is
// not under test here (the unit test owns it), so the container is not built.
vi.mock('#/composition', () => ({
  getContainer: () => ({ rateLimiter: { check: async () => ({ allowed: true }) } }),
}))

import { handleAuthRequest } from './$'

const BASE_URL = 'http://localhost:3000'
const PASSWORD = 'raw-route-password-123!'
const PREFIX = 'rawroute-'
const RUN = randomUUID()
const ORGANIZATION_ID = `${PREFIX}org-${RUN}`
const ORGANIZATION_NAME = 'Raw Route Hotel'
const INVITATION_ID = `${PREFIX}inv-${RUN}`

type Account = Readonly<{ id: string; email: string }>

let originalE2E: string | undefined
let accountAdmin: Account
let propertyManager: Account
let noMembership: Account

async function seedAccount(label: string): Promise<Account> {
  const id = `${PREFIX}${label}-${randomUUID()}`
  const email = `${id}@example.test`
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
     VALUES ($1, 'Raw Route Test', $2, true, NULL, now(), now())`,
    [id, email],
  )
  await getPool().query(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
    [`${PREFIX}account-${randomUUID()}`, id, await hashPassword(PASSWORD)],
  )
  return { id, email }
}

async function seedMember(account: Account, role: 'owner' | 'admin'): Promise<void> {
  await getPool().query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, $4, now())`,
    [`${PREFIX}member-${randomUUID()}`, ORGANIZATION_ID, account.id, role],
  )
}

/** One request through the route's handler, as the framework delivers it. */
async function request(
  method: 'GET' | 'POST',
  path: string,
  options: Readonly<{ cookie?: string; body?: unknown }> = {},
): Promise<Response> {
  const headers = new Headers({ origin: BASE_URL })
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return handleAuthRequest(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { rateLimit: method === 'POST' },
  )
}

async function signIn(account: Account): Promise<string> {
  const response = await request('POST', '/sign-in/email', {
    body: { email: account.email, password: PASSWORD },
  })
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/((?:__Secure-)?better-auth\.session_token)=([^;,]+)/)
  if (!response.ok || !match) {
    throw new Error(`Sign-in failed (${response.status}): ${setCookie || '(no cookie)'}`)
  }
  return `${match[1]}=${match[2]}`
}

async function organizationRow(
  where: Readonly<{ id: string } | { slug: string }>,
): Promise<{ id: string; name: string; contactEmail: string | null } | null> {
  const result =
    'id' in where
      ? await getPool().query<{ id: string; name: string; contactEmail: string | null }>(
          'SELECT id, name, "contactEmail" FROM organization WHERE id = $1',
          [where.id],
        )
      : await getPool().query<{ id: string; name: string; contactEmail: string | null }>(
          'SELECT id, name, "contactEmail" FROM organization WHERE slug = $1',
          [where.slug],
        )
  return result.rows[0] ?? null
}

async function cleanup(): Promise<void> {
  const organizations = await getPool().query<{ id: string }>(
    `SELECT id FROM organization WHERE id LIKE '${PREFIX}%' OR slug LIKE '${PREFIX}%'`,
  )
  const organizationIds = organizations.rows.map((row) => row.id)
  await withLastOwnerGuardDisabled(getPool(), async (client) => {
    await client.query(
      'DELETE FROM invitation WHERE "organizationId" = ANY($1::text[])',
      [organizationIds],
    )
    await client.query('DELETE FROM member WHERE "organizationId" = ANY($1::text[])', [
      organizationIds,
    ])
    await client.query(
      'DELETE FROM permission_version WHERE organization_id = ANY($1::text[])',
      [organizationIds],
    )
    await deleteTestOrganizations(client, organizationIds)
    await client.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}%'`)
  })
}

beforeAll(async () => {
  // The guarded test-only limiter hatch, as the sibling provider suites use
  // it: this suite is about which routes answer, not about brute force.
  originalE2E = process.env.E2E
  process.env.E2E = '1'
  resetEnv()

  await cleanup()
  await getPool().query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`,
    [ORGANIZATION_ID, ORGANIZATION_NAME, `${PREFIX}home-${RUN}`],
  )
  accountAdmin = await seedAccount('admin')
  propertyManager = await seedAccount('manager')
  noMembership = await seedAccount('nomember')
  await seedMember(accountAdmin, 'owner')
  await seedMember(propertyManager, 'admin')
  // A pending AccountAdmin invitation to an address with no account yet.
  await getPool().query(
    `INSERT INTO invitation
       (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
     VALUES ($1, $2, $3, 'owner', 'pending', now() + interval '1 day', $4, now())`,
    [
      INVITATION_ID,
      ORGANIZATION_ID,
      `${PREFIX}invitee-${RUN}@example.test`,
      accountAdmin.id,
    ],
  )
})

afterAll(async () => {
  await cleanup()
  if (originalE2E === undefined) delete process.env.E2E
  else process.env.E2E = originalE2E
  resetEnv()
})

describe('provider routes at the /api/auth boundary, real provider and database', () => {
  it('serves sign-in, the caller’s own session and sign-out', async () => {
    const cookie = await signIn(propertyManager)

    const session = await request('GET', '/get-session', { cookie })
    expect(session.status).toBe(200)
    await expect(session.json()).resolves.toMatchObject({
      user: { id: propertyManager.id, email: propertyManager.email },
    })

    const signOut = await request('POST', '/sign-out', { cookie, body: {} })
    expect(signOut.status).toBe(200)
    const after = await request('GET', '/get-session', { cookie })
    await expect(after.json()).resolves.toBeNull()
  })

  // The invitation id is the only secret invited registration asks for, so a
  // PropertyManager who can read it can register the invited AccountAdmin
  // address with a password of their own.
  it.each(['/organization/list-invitations', '/organization/get-full-organization'])(
    'never hands a PropertyManager the Organization’s invitation ids through %s',
    async (path) => {
      const cookie = await signIn(propertyManager)

      const response = await request(
        'GET',
        `${path}?organizationId=${encodeURIComponent(ORGANIZATION_ID)}`,
        { cookie },
      )
      const body = await response.text()

      expect({
        status: response.status,
        disclosesInvitationId: body.includes(INVITATION_ID),
      }).toEqual({ status: 404, disclosesInvitationId: false })
    },
  )

  // Organizations are operator-provisioned (ADR 0065): no signed-in
  // account may create one for itself, least of all one with no membership.
  it('never lets an account with no membership create an Organization', async () => {
    const cookie = await signIn(noMembership)
    const slug = `${PREFIX}self-${randomUUID()}`

    const response = await request('POST', '/organization/create', {
      cookie,
      body: { name: 'Mine', slug },
    })

    expect({
      status: response.status,
      created: (await organizationRow({ slug })) !== null,
    }).toEqual({ status: 404, created: false })
  })

  // The second fence. The route refusal is one layer; the provider is
  // configured to refuse a session-bound creation as well, so a second mount
  // of its handler would not reopen self-service.
  it('the provider refuses a session-bound creation, in process and over HTTP', async () => {
    const cookie = await signIn(noMembership)
    const slug = `${PREFIX}session-${randomUUID()}`
    const auth = getAuth()

    const overHttp = await auth.handler(
      new Request(`${BASE_URL}/api/auth/organization/create`, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          origin: BASE_URL,
          cookie,
        }),
        body: JSON.stringify({ name: 'Mine', slug }),
      }),
    )
    const refusal = (await overHttp.json()) as { code?: string }

    expect({ status: overHttp.status, code: refusal.code }).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION',
    })
    await expect(
      auth.api.createOrganization({
        headers: new Headers({ cookie }),
        body: { name: 'Mine', slug },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      body: { code: 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION' },
    })
    expect(await organizationRow({ slug })).toBeNull()
  })

  // The in-process path that survives the provider option: a server call that
  // names the user and carries no session is a system action. It is how the
  // dormant createOrganizationFn creates once its capability gate has passed,
  // and it leaves the session's active Organization for the caller to set.
  it('still creates as a system action, then activates the Organization for the session', async () => {
    const creator = await seedAccount('creator')
    const cookie = await signIn(creator)
    const headers = new Headers({ cookie })
    const slug = `${PREFIX}system-${randomUUID()}`
    const auth = getAuth()

    const created = await auth.api.createOrganization({
      body: { name: 'System Created', slug, userId: creator.id },
    })

    const membership = await getPool().query<{ role: string }>(
      'SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2',
      [created.id, creator.id],
    )
    expect(membership.rows).toEqual([{ role: 'owner' }])
    const before = await auth.api.getSession({ headers })
    expect(before?.session.activeOrganizationId ?? null).toBeNull()

    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: created.id },
    })

    const after = await auth.api.getSession({ headers })
    expect(after?.session.activeOrganizationId).toBe(created.id)
  })

  // The app's update asks the execution policy (kill switch,
  // suspension, restore mode) and validates the name, slug and contact
  // address. The provider's route checks the role and nothing else.
  it('never lets an AccountAdmin update the Organization around the app', async () => {
    const cookie = await signIn(accountAdmin)

    const response = await request('POST', '/organization/update', {
      cookie,
      body: {
        organizationId: ORGANIZATION_ID,
        data: { name: 'x', contactEmail: 'not-an-email' },
      },
    })

    const row = await organizationRow({ id: ORGANIZATION_ID })
    expect({
      status: response.status,
      name: row?.name,
      contactEmail: row?.contactEmail,
    }).toEqual({ status: 404, name: ORGANIZATION_NAME, contactEmail: null })
  })
})
