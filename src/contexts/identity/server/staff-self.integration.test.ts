// The staff home, own-code and notice server functions, called as signed-in
// members over PostgreSQL with the real staff resolver and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { requireHarnessRedis } from '#/shared/testing/server-function-require-redis'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { STAFF_NOTICE_VERSION } from '../domain/staff-account'
import { acknowledgeStaffNotice, getMyCode, getMyStaffHome } from './staff-self'

const harness = setupServerFunctionHarness({
  env: { PORTAL_ADDRESS_ENCRYPTION_KEYS: `1:${'44'.repeat(32)}` },
  cleanupTables: PORTAL_SEED_CLEANUP_TABLES,
  redis: true,
})

const OTHER_PARTICIPATION_ID = '22222222-2222-4222-8222-222222222222'

async function hotel() {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const staff = await harness.seedMember(organization, 'Member')
  return { organization, property, staff }
}

/** The person is the primary of their personal Portal, as setup makes them. */
async function makePrimary(
  property: Readonly<{ id: string; organizationId: string }>,
  participation: Readonly<{
    participationId: string
    personalPortal: { id: string } | null
  }>,
) {
  await harness.pool().query(
    `INSERT INTO portal_responsibilities
       (organization_id, property_id, portal_id, staff_participation_id, kind,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, 'primary', now() - interval '1 hour', 'harness')`,
    [
      property.organizationId,
      property.id,
      participation.personalPortal?.id,
      participation.participationId,
    ],
  )
}

async function staffAtLivePortal(propertyOptions: { lifecycle?: 'suspended' } = {}) {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization, propertyOptions)
  const staff = await harness.seedMember(organization, 'Member')
  const portal = await harness.seedPublishedPortal(property, {
    kind: 'personal',
    name: 'Polly Smith',
    publicName: 'Harbor',
    state: 'published',
  })
  const participation = await harness.seedStaffParticipation(staff, property, {
    personalPortal: portal,
    colleagueListEnabled: true,
  })
  await makePrimary(property, participation)
  return { organization, property, staff, participation }
}

describe('getMyStaffHome', () => {
  it('answers a staff member with only the home allowlist, marked uncacheable', async () => {
    const { staff, participation } = await staffAtLivePortal()

    const response = await harness.respondAs(staff, () => getMyStaffHome())

    expect(response.ok).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    if (!response.ok) return
    expect(response.value.participations).toHaveLength(1)
    const [home] = response.value.participations
    expect(home).toBeDefined()
    expect(Object.keys(home ?? {}).sort()).toEqual([
      'colleagueListEnabled',
      'look',
      'noticeAcknowledged',
      'participationId',
      'portalState',
      'propertyName',
    ])
    expect(home).toMatchObject({
      participationId: participation.participationId,
      propertyName: expect.any(String),
      noticeAcknowledged: true,
      colleagueListEnabled: true,
    })
  })

  it('reports the notice as not acknowledged for a person who has not read it', async () => {
    const { property, staff } = await hotel()
    await harness.seedStaffParticipation(staff, property, { noticeAcknowledged: false })

    const home = await harness.callAs(staff, () => getMyStaffHome())

    expect(home.participations[0]).toMatchObject({ noticeAcknowledged: false })
  })

  it('shows the default look for a Portal that is not set up yet', async () => {
    const { property, staff } = await hotel()
    await harness.seedStaffParticipation(staff, property)

    const home = await harness.callAs(staff, () => getMyStaffHome())

    expect(home.participations).toHaveLength(1)
    expect(home.participations[0]?.look).toMatchObject({ logo: null, hero: null })
  })

  it('keeps the home open on the Property look when the Portal snapshot does not parse', async () => {
    const { staff, participation } = await staffAtLivePortal()
    await harness
      .pool()
      .query(`UPDATE portal_publication_snapshots SET configuration = '{}'::jsonb`)

    const home = await harness.callAs(staff, () => getMyStaffHome())

    expect(home.participations).toHaveLength(1)
    expect(home.participations[0]).toMatchObject({
      participationId: participation.participationId,
      look: { logo: null, hero: null },
    })
  })

  it('admits an AccountAdmin who also has an active staff link', async () => {
    const { organization, property } = await hotel()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    await harness.seedStaffParticipation(admin, property)

    const home = await harness.callAs(admin, () => getMyStaffHome())

    expect(home.participations).toHaveLength(1)
  })

  it('refuses a member with no staff link', async () => {
    const { staff } = await hotel()

    await expect(harness.callAs(staff, () => getMyStaffHome())).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('refuses a linked person whose participation has ended', async () => {
    const { property, staff } = await hotel()
    const { participationId } = await harness.seedStaffParticipation(staff, property)
    await harness.pool().query(
      `UPDATE staff_participations
           SET status = 'archived', ended_at = now(), archive_reason = 'harness'
         WHERE id = $1`,
      [participationId],
    )

    await expect(harness.callAs(staff, () => getMyStaffHome())).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => getMyStaffHome())).rejects.toMatchObject({
      status: 401,
    })
  })
})

describe('getMyCode', () => {
  it('answers a live code with only the allowed fields', async () => {
    const { staff, participation } = await staffAtLivePortal()

    const response = await harness.respondAs(staff, () =>
      getMyCode({ data: { participationId: participation.participationId } }),
    )

    expect(response.ok).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    if (!response.ok) return
    expect(response.value).toMatchObject({ state: 'live', qr: expect.any(String) })
    expect(Object.keys(response.value)).not.toContain('direct')
    expect(Object.keys(response.value)).not.toContain('nfc')
  })

  it('answers only paused for an inactive Property', async () => {
    const { staff, participation } = await staffAtLivePortal({
      lifecycle: 'suspended',
    })

    const code = await harness.callAs(staff, () =>
      getMyCode({ data: { participationId: participation.participationId } }),
    )

    expect(code).toEqual({ state: 'paused' })
  })

  it('refuses the 121st code request in an hour with 429, under its own per-person key', async () => {
    const redis = requireHarnessRedis(harness)
    const { staff, participation } = await staffAtLivePortal()
    const data = { participationId: participation.participationId }
    for (let opened = 0; opened < 120; opened += 1) {
      await harness.callAs(staff, () => getMyCode({ data }))
    }

    await expect(harness.callAs(staff, () => getMyCode({ data }))).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
    const keys = await redis.keys('*staff:own-code:*')
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain(staff.userId)
  })

  it("refuses another person's participation id", async () => {
    const { staff } = await staffAtLivePortal()
    const colleague = await harness.seedMember(await harness.seedOrganization(), 'Member')
    const elsewhere = await harness.seedStaffParticipation(
      colleague,
      await harness.seedProperty(await harness.seedOrganization()),
    )

    for (const participationId of [elsewhere.participationId, OTHER_PARTICIPATION_ID]) {
      await expect(
        harness.callAs(staff, () => getMyCode({ data: { participationId } })),
      ).rejects.toMatchObject({
        message: 'Choose one of your own staff Properties',
      })
    }
  })

  it('refuses an id that is not a UUID', async () => {
    const { staff } = await staffAtLivePortal()

    await expect(
      harness.callAs(staff, () => getMyCode({ data: { participationId: 'nope' } })),
    ).rejects.toThrow(/participationId/)
  })
})

describe('acknowledgeStaffNotice', () => {
  it('records the served notice version on the staff link', async () => {
    const { property, staff } = await hotel()
    await harness.seedStaffParticipation(staff, property, { noticeAcknowledged: false })

    const answer = await harness.callAs(staff, () =>
      acknowledgeStaffNotice({ data: { version: STAFF_NOTICE_VERSION } }),
    )

    expect(answer).toEqual({ acknowledged: true })
    const { rows } = await harness
      .pool()
      .query(`SELECT notice_version FROM staff_user_links WHERE user_id = $1`, [
        staff.userId,
      ])
    expect(rows).toEqual([{ notice_version: STAFF_NOTICE_VERSION }])
  })

  it('refuses an older notice version and records nothing', async () => {
    const { property, staff } = await hotel()
    await harness.seedStaffParticipation(staff, property, { noticeAcknowledged: false })

    await expect(
      harness.callAs(staff, () => acknowledgeStaffNotice({ data: { version: 'older' } })),
    ).rejects.toMatchObject({ code: 'notice_version_changed', status: 409 })
    const { rows } = await harness
      .pool()
      .query(`SELECT notice_version FROM staff_user_links WHERE user_id = $1`, [
        staff.userId,
      ])
    expect(rows).toEqual([{ notice_version: null }])
  })
})
