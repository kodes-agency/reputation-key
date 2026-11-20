// The server-function harness itself: the request a call runs in, the
// response it leaves, the seeds and their options, cleanup, and the fakes the
// container was given.

import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { describe, expect, it } from 'vitest'
import { createTokenEncryptionAdapter } from '#/contexts/integration/connections/token-encryption.adapter.server'
import { getAuth } from '#/shared/auth/auth'
import { getEnv } from '#/shared/config/env'
import { setupServerFunctionHarness } from './server-function-harness'

const harness = setupServerFunctionHarness({
  googleTokenEncryption: createTokenEncryptionAdapter,
})

const REMEMBERED: { organizationId?: string; userId?: string } = {}

async function rowCount(sql: string, params: readonly unknown[]): Promise<number> {
  const { rows } = await harness.pool().query<{ n: number }>(sql, [...params])
  return rows[0]?.n ?? 0
}

describe('callAs and respondAs', () => {
  it('sends the caller’s cookie, extra cookies, extra headers and the Origin chosen', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'AccountAdmin')

    const headers = await harness.callAs(member, async () => getRequestHeaders(), {
      headers: { 'user-agent': 'HarnessBrowser/1.0', 'accept-language': 'de-DE' },
      cookies: ['rk_guest=guest-session'],
      origin: 'https://elsewhere.example',
    })

    expect(headers.get('user-agent')).toBe('HarnessBrowser/1.0')
    expect(headers.get('accept-language')).toBe('de-DE')
    expect(headers.get('origin')).toBe('https://elsewhere.example')
    expect(headers.get('cookie')).toBe(`${member.cookie}; rk_guest=guest-session`)
  })

  it('sends the app’s own origin by default and none when told', async () => {
    const own = await harness.callAs(null, async () => getRequestHeaders())
    const none = await harness.callAs(null, async () => getRequestHeaders(), {
      origin: null,
    })

    expect(own.get('origin')).toBe(new URL(getEnv().BETTER_AUTH_URL).origin)
    expect(own.get('cookie')).toBeNull()
    expect(none.get('origin')).toBeNull()
  })

  it('keeps the response headers a call set, also when it throws', async () => {
    const answered = await harness.respondAs(null, async () => {
      setResponseHeader('cache-control', 'private, no-store')
      return 'answer'
    })
    const refused = await harness.respondAs(null, async () => {
      setResponseHeader('retry-after', '60')
      throw new Error('refused')
    })

    expect(answered).toMatchObject({ ok: true, value: 'answer', status: 200 })
    expect(answered.headers.get('cache-control')).toBe('private, no-store')
    expect(refused).toMatchObject({ ok: false, error: new Error('refused') })
    expect(refused.headers.get('retry-after')).toBe('60')
    await expect(
      harness.callAs(null, async () => {
        throw new Error('rethrown')
      }),
    ).rejects.toThrow('rethrown')
  })
})

describe('identity seeds', () => {
  it('seeds an Organization and member under fixed ids, with the password they sign in with', async () => {
    const organization = await harness.seedOrganization({ id: 'org-harness-fixed-id-1' })
    const member = await harness.seedMember(organization, 'PropertyManager', {
      userId: 'user-harness-fixed-id-1',
      emailVerified: false,
    })

    expect(organization.id).toBe('org-harness-fixed-id-1')
    expect(member).toMatchObject({
      userId: 'user-harness-fixed-id-1',
      memberId: 'member-user-harness-fixed-id-1',
      organizationId: organization.id,
      role: 'PropertyManager',
    })
    const { rows } = await harness.pool().query<{ emailVerified: boolean; role: string }>(
      `SELECT u."emailVerified", m.role FROM "user" u JOIN member m ON m."userId" = u.id
          WHERE m.id = $1`,
      [member.memberId],
    )
    expect(rows).toEqual([{ emailVerified: false, role: 'admin' }])
    const signedIn = await getAuth().api.signInEmail({
      body: { email: member.email, password: member.password },
      headers: new Headers(),
    })
    expect(signedIn.user.id).toBe(member.userId)
  })

  it('signs in a visitor who belongs to no Organization', async () => {
    const visitor = await harness.seedVisitor()

    const session = await harness.callAs(visitor, () =>
      getAuth().api.getSession({ headers: getRequestHeaders() }),
    )

    expect(session?.user.id).toBe(visitor.userId)
    expect(session?.session.activeOrganizationId ?? null).toBeNull()
    expect(
      await rowCount(`SELECT count(*)::int AS n FROM member WHERE "userId" = $1`, [
        visitor.userId,
      ]),
    ).toBe(0)
  })

  it('seeds a pending invitation to Properties', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const property = await harness.seedProperty(organization)

    const invitation = await harness.seedInvitation(organization, {
      inviter: admin,
      email: 'invitee@example.test',
      propertyIds: [property.id],
    })

    const { rows } = await harness
      .pool()
      .query(
        `SELECT email, role, status, "propertyIds", "inviterId" FROM invitation WHERE id = $1`,
        [invitation.id],
      )
    expect(rows).toEqual([
      {
        email: 'invitee@example.test',
        role: 'admin',
        status: 'pending',
        propertyIds: JSON.stringify([property.id]),
        inviterId: admin.userId,
      },
    ])
  })
})

describe('property seeds', () => {
  it('seeds a Property with its name, timezone, reply language and lifecycle', async () => {
    const organization = await harness.seedOrganization()

    const property = await harness.seedProperty(organization, {
      name: 'Riverside Inn',
      timezone: 'Europe/Sofia',
      defaultReplyLanguage: 'bg-Cyrl',
      lifecycle: 'suspended',
    })

    const { rows } = await harness.pool().query(
      `SELECT name, timezone, default_reply_language, lifecycle_state, google_binding_state
           FROM properties WHERE id = $1`,
      [property.id],
    )
    expect(rows).toEqual([
      {
        name: 'Riverside Inn',
        timezone: 'Europe/Sofia',
        default_reply_language: 'bg-Cyrl',
        lifecycle_state: 'suspended',
        google_binding_state: 'unbound',
      },
    ])
  })

  it('binds a Property to Google through a connection whose tokens the app can read', async () => {
    const organization = await harness.seedOrganization()

    const property = await harness.seedProperty(organization, {
      google: { locationId: 'location-77' },
      reviewDestination: true,
    })

    const { rows } = await harness.pool().query<{
      google_binding_state: string
      gbp_location_id: string
      google_review_destination_state: string
      encrypted_access_token: string
    }>(
      `SELECT p.google_binding_state, p.gbp_location_id, p.google_review_destination_state,
              c.encrypted_access_token
         FROM properties p JOIN google_connections c ON c.id = p.google_connection_id
        WHERE p.id = $1`,
      [property.id],
    )
    expect(rows[0]).toMatchObject({
      google_binding_state: 'active',
      gbp_location_id: 'location-77',
      google_review_destination_state: 'verified',
    })
    const sealer = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: getEnv().ENCRYPTION_KEY },
    })
    expect(sealer.decrypt(rows[0]?.encrypted_access_token ?? '')).toBe(
      'harness-access-token',
    )
  })

  it('seeds a personal published Portal with its locales', async () => {
    const organization = await harness.seedOrganization()
    const property = await harness.seedProperty(organization)

    const portal = await harness.seedPortal(property, {
      kind: 'personal',
      publicName: 'Maria',
      state: 'published',
      primaryLocale: 'de',
      additionalLocales: ['en'],
    })

    const { rows } = await harness.pool().query(
      `SELECT kind, public_name, publication_state, primary_guest_locale,
                additional_guest_locales
           FROM portals WHERE id = $1`,
      [portal.id],
    )
    expect(rows).toEqual([
      {
        kind: 'personal',
        public_name: 'Maria',
        publication_state: 'published',
        primary_guest_locale: 'de',
        additional_guest_locales: ['en'],
      },
    ])
  })
})

describe('cleanup', () => {
  it('tracks an Organization and a user a call created', async () => {
    const organizationId = `org-harness-made-by-a-call-${Date.now()}`
    const userId = `user-harness-made-by-a-call-${Date.now()}`
    await harness
      .pool()
      .query(
        `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Made', $2, NOW())`,
        [organizationId, `m-${organizationId}`],
      )
    await harness.pool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, 'Made', $2, true, NOW(), NOW())`,
      [userId, `${userId}@example.test`],
    )
    harness.trackOrganization(organizationId)
    harness.trackUser(userId)
    REMEMBERED.organizationId = organizationId
    REMEMBERED.userId = userId
  })

  it('deleted them after the test that made them', async () => {
    expect(
      await rowCount(`SELECT count(*)::int AS n FROM organization WHERE id = $1`, [
        REMEMBERED.organizationId,
      ]),
    ).toBe(0)
    expect(
      await rowCount(`SELECT count(*)::int AS n FROM "user" WHERE id = $1`, [
        REMEMBERED.userId,
      ]),
    ).toBe(0)
  })
})

describe('fakes', () => {
  it('hands the container the queues and storage the test reads', async () => {
    const fakes = harness.fakes()

    expect(harness.container().jobQueue).toBe(fakes.queues.default)
    await fakes.storage.putObject('k', Buffer.from('v'), 'text/plain')
    fakes.storage.failNextGet(new Error('storage down'))

    await expect(fakes.storage.getObject('k', 10)).rejects.toThrow('storage down')
    expect(await fakes.storage.getObject('k', 10)).not.toBeNull()
  })

  it('captures email and fails the next send when told', async () => {
    const { email } = harness.fakes()
    const invitation = {
      email: 'a@example.test',
      invitedByUsername: 'Ann',
      organizationName: 'Harness Hotels',
      inviteLink: 'https://app.example/invite',
      role: 'Member' as const,
      propertyNames: [],
      expiresInDays: 7,
    }
    email.failNext(new Error('mail down'))

    await expect(email.send(invitation)).rejects.toThrow('mail down')
    await email.send(invitation)

    expect(email.captured()).toEqual([invitation])
  })
})
