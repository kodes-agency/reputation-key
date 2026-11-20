// The invitation link's preview, called by an anonymous visitor over
// PostgreSQL and the test Redis, with the real rate limiter and client address.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getInvitationPreview } from './invitation-preview'

const harness = setupServerFunctionHarness({
  env: { TRUSTED_PROXY_MODE: 'xff', TRUSTED_PROXY_COUNT: '1' },
  redis: true,
})

const FROM_HOTEL = { headers: { 'x-forwarded-for': '198.51.100.7' } }
const FROM_ELSEWHERE = { headers: { 'x-forwarded-for': '203.0.113.20' } }

async function invited() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization, { name: 'Riverside Inn' })
  return harness.seedInvitation(organization, {
    inviter: admin,
    email: 'new.manager@example.test',
    propertyIds: [property.id],
  })
}

describe('getInvitationPreview server function', () => {
  it('returns what the invitation email states for the link', async () => {
    const invitation = await invited()

    const preview = await harness.callAs(
      null,
      () => getInvitationPreview({ data: { invitationId: invitation.id } }),
      FROM_HOTEL,
    )

    expect(preview).toMatchObject({
      state: 'pending',
      invitationId: invitation.id,
      organizationName: 'Harness Hotels',
      role: 'PropertyManager',
      propertyNames: ['Riverside Inn'],
      email: 'new.manager@example.test',
      accountExists: false,
    })
  })

  it('answers one shape for an id that is no usable invitation', async () => {
    await expect(
      harness.callAs(
        null,
        () => getInvitationPreview({ data: { invitationId: 'inv-link-1' } }),
        FROM_HOTEL,
      ),
    ).resolves.toEqual({ state: 'unavailable' })
  })

  it('refuses with 429 once one address used its 60 reads, and still answers another', async () => {
    const redis = harness.redis()
    if (!redis) return
    const invitation = await invited()
    const read = (request: typeof FROM_HOTEL) =>
      harness.callAs(
        null,
        () => getInvitationPreview({ data: { invitationId: invitation.id } }),
        request,
      )
    for (let opened = 0; opened < 60; opened += 1) await read(FROM_HOTEL)

    await expect(read(FROM_HOTEL)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'rate_limited',
      status: 429,
    })
    await expect(read(FROM_ELSEWHERE)).resolves.toMatchObject({ state: 'pending' })
    expect(
      await redis.ttl('ratelimit:public:identity:invitation-preview:198.51.100.7'),
    ).toBeGreaterThan(540)
  })
})
