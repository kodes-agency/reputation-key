// Publishing a live Portal's changes, one Portal or several, called as signed-in
// members over PostgreSQL with the real tenant resolution, execution policy and
// Portal scope. Each refusal is asserted on the versions left behind.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestMember, TestProperty } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { publishPortalChanges, publishPortalsChanges } from './portal-publish-changes'
import { getPortalReview } from './portal-review'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    ...PORTAL_SEED_CLEANUP_TABLES,
    'portal_pending_content_changes',
    'portal_page_edits',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
  ],
})

const MISSING_PORTAL = '00000000-0000-4000-8000-0000000000aa'

/** The Property's brand and wording in both Portal languages: what a live Portal needs to republish. */
async function seedWording(property: TestProperty): Promise<void> {
  const at = new Date(Date.now() - 5000)
  await harness.pool().query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, background_mode, look_version,
        primary_color, background_color, text_color, version, updated_by, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'Harbor', 'auto', 1, '#1D4ED8', '#101820',
             '#111827', 1, 'harness', $3, $3)`,
    [property.organizationId, property.id, at],
  )
  for (const locale of ['en', 'bg']) {
    await harness.pool().query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description, version,
          updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Harbor Hotel', 'Welcome', 1, 'harness', $4, $4)`,
      [property.organizationId, property.id, locale, at],
    )
  }
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const harbour = await harness.seedProperty(organization)
  const garden = await harness.seedProperty(organization)
  await harness.grantProperty(manager, harbour)
  await seedWording(harbour)
  await seedWording(garden)
  const harbourPortal = await harness.seedPublishedPortal(harbour)
  const harbourSecond = await harness.seedPublishedPortal(harbour)
  const gardenPortal = await harness.seedPublishedPortal(garden)
  return {
    organization,
    admin,
    manager,
    member,
    harbour,
    harbourPortal,
    harbourSecond,
    gardenPortal,
  }
}

/** What the manager reviewed: the digest the page sends back when publishing. */
async function reviewed(caller: TestMember, portalId: string) {
  const review = await harness.callAs(caller, () =>
    getPortalReview({ data: { portalId } }),
  )
  if (!review.reviewDigest) throw new Error('Nothing to review')
  return { portalId, reviewedDigest: review.reviewDigest }
}

const versions = async (portalId: string) =>
  (
    await harness
      .pool()
      .query<{ version: number }>(
        `SELECT version FROM portal_publication_snapshots WHERE portal_id = $1 ORDER BY version`,
        [portalId],
      )
  ).rows.map((row) => row.version)

describe('publishPortalChanges', () => {
  it.each(['admin', 'manager'] as const)(
    'publishes the pending changes as %s and closes the previous version as replaced',
    async (who) => {
      const { harbourPortal, ...people } = await hotel()
      const caller = people[who]

      const result = await harness.callAs(caller, async () =>
        publishPortalChanges({ data: await reviewed(caller, harbourPortal.id) }),
      )

      expect(result).toMatchObject({
        outcome: 'published',
        version: 2,
        snapshotId: expect.any(String),
        configurationDigest: expect.any(String),
      })
      expect(await versions(harbourPortal.id)).toEqual([1, 2])
      const { rows } = await harness.pool().query<{ deactivation_reason: string | null }>(
        `SELECT a.deactivation_reason
           FROM portal_publication_activations a
           JOIN portal_publication_snapshots s ON s.id = a.snapshot_id
          WHERE a.portal_id = $1 AND s.version = 1`,
        [harbourPortal.id],
      )
      expect(rows).toEqual([{ deactivation_reason: 'replaced' }])
    },
  )

  it('answers unchanged, and publishes nothing, when the live version already says what the draft says', async () => {
    const { admin, harbourPortal } = await hotel()
    await harness.callAs(admin, async () =>
      publishPortalChanges({ data: await reviewed(admin, harbourPortal.id) }),
    )

    const result = await harness.callAs(admin, () =>
      publishPortalChanges({
        data: { portalId: harbourPortal.id, reviewedDigest: 'already-live' },
      }),
    )

    expect(result).toEqual({ outcome: 'unchanged', version: 2 })
    expect(await versions(harbourPortal.id)).toEqual([1, 2])
  })

  it('refuses a PropertyManager without a grant and publishes nothing', async () => {
    const { organization, admin, harbourPortal } = await hotel()
    const ungranted = await harness.seedMember(organization, 'PropertyManager')
    const digest = await reviewed(admin, harbourPortal.id)

    await expect(
      harness.callAs(ungranted, () => publishPortalChanges({ data: digest })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    expect(await versions(harbourPortal.id)).toEqual([1])
  })

  it('refuses a Member and publishes nothing', async () => {
    const { admin, member, harbourPortal } = await hotel()
    const digest = await reviewed(admin, harbourPortal.id)

    await expect(
      harness.callAs(member, () => publishPortalChanges({ data: digest })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })

    expect(await versions(harbourPortal.id)).toEqual([1])
  })

  it('answers a Portal that does not exist as not found', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        publishPortalChanges({
          data: { portalId: MISSING_PORTAL, reviewedDigest: 'digest' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it("answers another Organization's Portal as not found and publishes nothing", async () => {
    const { admin, harbourPortal } = await hotel()
    const digest = await reviewed(admin, harbourPortal.id)
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(stranger, () => publishPortalChanges({ data: digest })),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(await versions(harbourPortal.id)).toEqual([1])
  })

  it('refuses a Portal that is not live', async () => {
    const { admin, harbour } = await hotel()
    const draft = await harness.seedPortal(harbour, { name: 'Draft' })

    await expect(
      harness.callAs(admin, () =>
        publishPortalChanges({ data: { portalId: draft.id, reviewedDigest: 'digest' } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition', status: 409 })
  })
})

describe('publishPortalsChanges', () => {
  it('publishes each named Portal and answers one outcome per Portal', async () => {
    const { admin, harbourPortal, harbourSecond } = await hotel()

    const outcomes = await harness.callAs(admin, async () =>
      publishPortalsChanges({
        data: {
          portals: [
            await reviewed(admin, harbourPortal.id),
            await reviewed(admin, harbourSecond.id),
          ],
        },
      }),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ portalId: harbourPortal.id, outcome: 'published' }),
      expect.objectContaining({ portalId: harbourSecond.id, outcome: 'published' }),
    ])
    expect(await versions(harbourPortal.id)).toEqual([1, 2])
    expect(await versions(harbourSecond.id)).toEqual([1, 2])
  })

  it('refuses the whole request, and publishes none of them, when one Portal is outside the actor’s scope', async () => {
    const { admin, manager, harbourPortal, gardenPortal } = await hotel()
    const portals = [
      await reviewed(admin, harbourPortal.id),
      await reviewed(admin, gardenPortal.id),
    ]

    await expect(
      harness.callAs(manager, () => publishPortalsChanges({ data: { portals } })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    expect(await versions(harbourPortal.id)).toEqual([1])
    expect(await versions(gardenPortal.id)).toEqual([1])
  })

  it('reports a Portal that does not exist, or belongs to another Organization, as that Portal’s own failure while the others publish', async () => {
    const { admin, harbourPortal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherProperty = await harness.seedProperty(elsewhere)
    const foreign = await harness.seedPublishedPortal(otherProperty)

    const outcomes = await harness.callAs(admin, async () =>
      publishPortalsChanges({
        data: {
          portals: [
            await reviewed(admin, harbourPortal.id),
            { portalId: MISSING_PORTAL, reviewedDigest: 'digest' },
            { portalId: foreign.id, reviewedDigest: 'digest' },
          ],
        },
      }),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ portalId: harbourPortal.id, outcome: 'published' }),
      expect.objectContaining({
        portalId: MISSING_PORTAL,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
      expect.objectContaining({
        portalId: foreign.id,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
    expect(await versions(harbourPortal.id)).toEqual([1, 2])
    expect(await versions(foreign.id)).toEqual([1])
  })
})
