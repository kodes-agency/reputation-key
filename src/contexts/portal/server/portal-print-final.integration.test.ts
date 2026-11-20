// Saving the print kit's wording and downloading the print file, called as
// signed-in members over PostgreSQL and the test Redis with the real tenant
// resolution, execution policy and Portal scope. Both are marked and limited as
// the app does: a download is uncacheable before any refusal and spends the
// address limit; wording writes have a budget of their own.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { downloadPortalPrintFinal, savePortalPrintWording } from './portal-print-final'

const harness = setupServerFunctionHarness({
  env: { PORTAL_ADDRESS_ENCRYPTION_KEYS: `1:${'44'.repeat(32)}` },
  redis: true,
  cleanupTables: ['portal_print_wordings', ...PORTAL_SEED_CLEANUP_TABLES],
})

const NO_STORE = 'private, no-store, max-age=0'
const MISSING_PORTAL = '00000000-0000-4000-8000-0000000000aa'
const WORDS = { en: { headline: 'Thanks for staying', subline: 'Tell us more' } }

const wording = (portalId: string) => ({
  portalId,
  callToAction: 'how_was_stay' as const,
  customWords: WORDS,
})

const download = (portalId: string, languages: ('en' | 'bg' | 'de')[] = ['en']) => ({
  portalId,
  piece: 'tent' as const,
  orientation: 'wide' as const,
  look: 'paper' as const,
  printer: 'my_printer' as const,
  quantity: 8,
  fillSpares: false,
  languages,
  callToAction: 'how_did_we_do' as const,
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property)
  return { organization, admin, manager, property, portal }
}

const savedWordings = async (portalId: string) =>
  (
    await harness
      .pool()
      .query<{ call_to_action: string }>(
        `SELECT call_to_action FROM portal_print_wordings WHERE portal_id = $1`,
        [portalId],
      )
  ).rows

describe('savePortalPrintWording', () => {
  it('saves the wording as an Account Admin and answers what was saved', async () => {
    const { admin, portal } = await hotel()

    const saved = await harness.callAs(admin, () =>
      savePortalPrintWording({ data: wording(portal.id) }),
    )

    expect(saved).toEqual({ callToAction: 'how_was_stay', customWords: WORDS })
    expect(await savedWordings(portal.id)).toEqual([{ call_to_action: 'how_was_stay' }])
  })

  it('saves for a PropertyManager granted on the Property, and the next save replaces the last', async () => {
    const { manager, property, portal } = await hotel()
    await harness.grantProperty(manager, property)

    await harness.callAs(manager, () =>
      savePortalPrintWording({ data: wording(portal.id) }),
    )
    await harness.callAs(manager, () =>
      savePortalPrintWording({
        data: { portalId: portal.id, callToAction: 'how_did_we_do' },
      }),
    )

    expect(await savedWordings(portal.id)).toEqual([{ call_to_action: 'how_did_we_do' }])
  })

  it('refuses a PropertyManager without a grant and saves nothing', async () => {
    const { manager, portal } = await hotel()

    await expect(
      harness.callAs(manager, () => savePortalPrintWording({ data: wording(portal.id) })),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('refuses a Member and saves nothing', async () => {
    const { organization, portal } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => savePortalPrintWording({ data: wording(portal.id) })),
    ).rejects.toMatchObject({ status: 403 })

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('refuses a visitor with no session', async () => {
    const { portal } = await hotel()

    await expect(
      harness.callAs(null, () => savePortalPrintWording({ data: wording(portal.id) })),
    ).rejects.toMatchObject({ status: 401 })

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('answers a Portal that does not exist as a 404', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        savePortalPrintWording({ data: wording(MISSING_PORTAL) }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it("answers another Organization's Portal as a 404 and saves nothing", async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(stranger, () =>
        savePortalPrintWording({ data: wording(portal.id) }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('refuses words that offer something for the review, and saves nothing', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        savePortalPrintWording({
          data: {
            portalId: portal.id,
            callToAction: 'how_was_stay',
            customWords: { en: { headline: 'Get 10% off', subline: '' } },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'print_format_not_offered', status: 400 })

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('refuses words the validator rejects before anything runs', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        savePortalPrintWording({
          data: {
            portalId: portal.id,
            callToAction: 'how_was_stay',
            customWords: { en: { headline: '', subline: '' } },
          },
        }),
      ),
    ).rejects.toThrow(/headline/i)

    expect(await savedWordings(portal.id)).toEqual([])
  })

  it('spends its own budget: refuses with 429 after 30 saves and saves nothing more, while a download is still allowed', async () => {
    const { admin, organization, portal } = await hotel()
    const redis = harness.redis()
    if (!redis) return
    await redis.set(
      `ratelimit:public:portal:print-wording:actor:${organization.id}:${admin.userId}`,
      '30',
      'EX',
      3600,
    )

    await expect(
      harness.callAs(admin, () => savePortalPrintWording({ data: wording(portal.id) })),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
    expect(await savedWordings(portal.id)).toEqual([])

    // The download is not limited: it gets past the limit and is refused for its languages.
    await expect(
      harness.callAs(admin, () =>
        downloadPortalPrintFinal({ data: download(portal.id, ['de']) }),
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered', status: 400 })
  })
})

describe('downloadPortalPrintFinal', () => {
  it('refuses a language the Portal does not offer, uncacheable', async () => {
    const { admin, portal } = await hotel()

    const response = await harness.respondAs(admin, () =>
      downloadPortalPrintFinal({ data: download(portal.id, ['en', 'de']) }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'locale_not_offered', status: 400 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    expect(response.headers.get('pragma')).toBe('no-cache')
  })

  it('asks a draft Portal to be published first, after spending the address limit', async () => {
    const { admin, organization, property } = await hotel()
    const draft = await harness.seedPortal(property, { name: 'Draft' })

    const response = await harness.respondAs(admin, () =>
      downloadPortalPrintFinal({ data: download(draft.id) }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'publication_snapshot_unavailable', status: 409 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    const redis = harness.redis()
    if (!redis) return
    const prefix = 'ratelimit:public:portal:address-reveal'
    expect(await redis.get(`${prefix}:actor:${organization.id}:${admin.userId}`)).toBe(
      '1',
    )
    expect(await redis.get(`${prefix}:organization:${organization.id}`)).toBe('1')
  })

  it('refuses a PropertyManager without a grant before spending anything, uncacheable', async () => {
    const { manager, organization, portal } = await hotel()

    const response = await harness.respondAs(manager, () =>
      downloadPortalPrintFinal({ data: download(portal.id) }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { name: 'AuthError', code: 'scope_denied', status: 403 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    const redis = harness.redis()
    if (!redis) return
    expect(
      await redis.exists(
        `ratelimit:public:portal:address-reveal:organization:${organization.id}`,
      ),
    ).toBe(0)
  })

  it('refuses a Member', async () => {
    const { organization, portal } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        downloadPortalPrintFinal({ data: download(portal.id) }),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('answers a Portal that does not exist as a 404', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        downloadPortalPrintFinal({ data: download(MISSING_PORTAL) }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it("answers another Organization's Portal as a 404", async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(stranger, () =>
        downloadPortalPrintFinal({ data: download(portal.id) }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('refuses with 429 once the actor used its downloads, still uncacheable', async () => {
    const { admin, organization, portal } = await hotel()
    const redis = harness.redis()
    if (!redis) return
    await redis.set(
      `ratelimit:public:portal:address-reveal:actor:${organization.id}:${admin.userId}`,
      '30',
      'EX',
      3600,
    )

    const response = await harness.respondAs(admin, () =>
      downloadPortalPrintFinal({ data: download(portal.id) }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', status: 429 },
    })
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
  })
})
