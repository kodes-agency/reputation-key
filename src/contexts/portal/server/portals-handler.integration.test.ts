// Portal go-live and archive server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy. Each refusal
// is asserted on the Portal row it leaves.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestPortal } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { archivePortal, publishPortal } from './portals'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_health_intervals',
    'portal_pending_content_changes',
    'portal_page_edits',
  ],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  // Commands fence on the revision they read, which a JS Date holds to the millisecond.
  await harness
    .pool()
    .query(
      `UPDATE portals SET updated_at = date_trunc('milliseconds', updated_at) WHERE id = $1`,
      [portal.id],
    )
  return { organization, admin, manager, property, portal }
}

const portalRow = async (portal: TestPortal) =>
  (
    await harness
      .pool()
      .query<{ publication_state: string; deleted_at: Date | null }>(
        `SELECT publication_state, deleted_at FROM portals WHERE id = $1`,
        [portal.id],
      )
  ).rows[0]

const DRAFT = { publication_state: 'draft', deleted_at: null }

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

describe('publishPortal', () => {
  it('refuses go-live without a reviewed digest and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        publishPortal({ data: { portalId: portal.id } as never }),
      ),
    ).rejects.toThrow(/reviewedDigest/)

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses a PropertyManager without a grant and leaves the Portal a draft', async () => {
    const { organization, portal } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it("answers not found for another Organization's Portal and leaves it untouched", async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })
})

describe('Portal writes switched off', () => {
  it('refuses go-live and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () =>
        publishPortal({
          data: { portalId: portal.id, reviewedDigest: 'reviewed-digest' },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })

  it('refuses archiving and leaves the Portal a draft', async () => {
    const { admin, portal } = await hotel()
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () => archivePortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })
})

describe('archivePortal', () => {
  it('archives the Portal recoverably: its state is archived and the row is not deleted', async () => {
    const { admin, portal } = await hotel()

    await harness.callAs(admin, () => archivePortal({ data: { portalId: portal.id } }))

    expect(await portalRow(portal)).toEqual({
      publication_state: 'archived',
      deleted_at: null,
    })
  })

  it('refuses a PropertyManager, even one with a grant, and leaves the Portal as it was', async () => {
    const { manager, property, portal } = await hotel()
    await harness.grantProperty(manager, property)

    await expect(
      harness.callAs(manager, () => archivePortal({ data: { portalId: portal.id } })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })

    expect(await portalRow(portal)).toEqual(DRAFT)
  })
})
