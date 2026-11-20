// The Review & publish read, called as signed-in members over PostgreSQL with
// the real tenant resolution, execution policy and Portal scope. The page never
// shows a Publish button the server would refuse: `canPublish` agrees with the
// write gate that publishing asks again.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestProperty } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { publishPortalChanges } from './portal-publish-changes'
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
  const ungranted = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const draft = await harness.seedPortal(property, { name: 'Draft' })
  const live = await harness.seedPublishedPortal(property)
  return { organization, admin, manager, ungranted, member, property, draft, live }
}

afterEach(resetCapabilityPolicyStore)

const read = (caller: Parameters<typeof harness.callAs>[0], portalId: string) =>
  harness.callAs(caller, () => getPortalReview({ data: { portalId } }))

describe('getPortalReview', () => {
  it.each(['admin', 'manager'] as const)(
    "reads a draft Portal's review as %s: it publishes as version 1 and names what is missing",
    async (who) => {
      const { draft, ...people } = await hotel()

      const review = await read(people[who], draft.id)

      expect(review).toMatchObject({
        portalId: draft.id,
        publicationState: 'draft',
        action: 'publish',
        publishesAsVersion: 1,
        canPublish: false,
        reviewDigest: null,
      })
      expect(review.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'public_address', status: 'blocked' }),
          expect.objectContaining({ code: 'primary_text', status: 'blocked' }),
        ]),
      )
    },
  )

  it.each(['admin', 'manager'] as const)(
    'reads a ready live Portal as %s: it publishes its changes and may be published',
    async (who) => {
      const { property, live, ...people } = await hotel()
      await seedWording(property)

      const review = await read(people[who], live.id)

      expect(review).toMatchObject({
        portalId: live.id,
        publicationState: 'published',
        action: 'publish_changes',
        publishesAsVersion: 2,
        canPublish: true,
      })
      expect(review.reviewDigest).toEqual(expect.any(String))
    },
  )

  it('reads canPublish false for a live Portal with unmet gates, whoever asks', async () => {
    const { admin, live } = await hotel()

    const review = await read(admin, live.id)

    expect(review).toMatchObject({ action: 'publish_changes', canPublish: false })
    expect(review.checks).toContainEqual(
      expect.objectContaining({ code: 'primary_text', status: 'blocked' }),
    )
  })

  it('refuses a PropertyManager without a grant, with no review in the error', async () => {
    const { ungranted, live } = await hotel()

    const response = await harness.respondAs(ungranted, () =>
      getPortalReview({ data: { portalId: live.id } }),
    )

    expect(response).toMatchObject({
      ok: false,
      error: { name: 'AuthError', code: 'scope_denied', status: 403 },
    })
    expect(JSON.stringify(!response.ok && response.error)).not.toContain('checks')
  })

  it('refuses a Member', async () => {
    const { member, live } = await hotel()

    await expect(read(member, live.id)).rejects.toMatchObject({
      code: 'beta_role_inactive',
      status: 403,
    })
  })

  it("answers another Organization's Portal as not found", async () => {
    const { live } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(read(stranger, live.id)).rejects.toMatchObject({
      code: 'portal_not_found',
      status: 404,
    })
  })

  it('still reads when Portal writes are switched off, but cannot be published, as publishing itself refuses', async () => {
    const { admin, property, live } = await hotel()
    await seedWording(property)
    const { reviewDigest } = await read(admin, live.id)
    initCapabilityPolicyStore({
      isCapabilityKilled: (cap) => cap === 'portal.write',
      isOrgSuspended: () => false,
    })

    const review = await read(admin, live.id)

    expect(review).toMatchObject({ action: 'publish_changes', canPublish: false })
    await expect(
      harness.callAs(admin, () =>
        publishPortalChanges({
          data: { portalId: live.id, reviewedDigest: reviewDigest ?? 'none' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'capability_disabled', status: 403 })
  })
})
