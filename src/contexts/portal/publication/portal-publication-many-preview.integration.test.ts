// Publish changes while live, preview them, make an earlier version live again
// and complete a content review, on real PostgreSQL with two organizations: the
// results a manager sees, the refusals, the snapshots and activations written
// and the facts recorded. The real use cases run over the real stores and
// command store; only the clock, the ids and the other contexts' answers (the
// Property's destination and lifecycle, the staff assignments) are fixed.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { portalId, type OrganizationId } from '#/shared/domain/ids'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot.server'
import {
  LIVE_DESTINATION,
  MANAGER,
  NOW,
  ORG_A,
  ORG_B,
  READINESS_GATES,
  clearFacts,
  ctxOf,
  expectNothingWritten,
  factsOf,
  getPool,
  giveAddress,
  goLive,
  seedLive,
  seedReady,
  setState,
  setupLifecycleDb,
  snapshotsOf,
  sourceOf,
  EDITED_AT,
  wire,
  type Address,
  type Live,
} from './portal-publication-lifecycle.test-fixtures'
import { seedSiblingPortal } from './portal-working-copy-seed.test-fixtures'
import { getDb } from '#/shared/db'
import { recordPortalPendingContentChange } from './portal-pending-content-changes.server'

/** Recorded changes still waiting to go live, without moving the draft. */
export async function openChanges(live: Live, count: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (let index = 0; index < count; index += 1) {
      await recordPortalPendingContentChange(tx, {
        organizationId: live.org,
        propertyId: live.property,
        portalId: live.portal,
        kind: 'portal_links',
        key: `link:${index}`,
        sourceVersion: EDITED_AT.toISOString(),
        changedAt: EDITED_AT,
      })
    }
  })
}

setupLifecycleDb()

describe.sequential('publishPortalsChanges (real PostgreSQL, two tenants)', () => {
  /** Two live Portals of one Property, each with a recorded change pending. */
  async function seedTwo(address: readonly [Address, Address] = ['current', 'current']) {
    const first = await seedLive(ORG_A)
    const secondId = portalId(randomUUID())
    await seedSiblingPortal(getPool(), first.seed, {
      portalId: secondId,
      slug: `second-${secondId.slice(0, 8)}`,
    })
    const second: Live = { ...first, portal: secondId }
    await goLive(second)
    await giveAddress(first, address[0])
    await giveAddress(second, address[1])
    await openChanges(first, 1)
    await openChanges(second, 1)
    await clearFacts()
    return { first, second }
  }

  const publishedOrder = async (org: OrganizationId) =>
    (await factsOf(org, 'portal.publication.published')).map(
      (row) => row.payload.portalId,
    )

  it('publishes each Portal in order and reports the outcome per Portal', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const missing = randomUUID()

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }, { portalId: missing }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({ portalId: live.portal, outcome: 'published' }),
      expect.objectContaining({
        portalId: missing,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
  })

  it('goes on after a Portal that cannot be published', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: randomUUID() }, { portalId: live.portal }] },
      ctxOf(ORG_A),
    )

    expect(results.map((result) => result.outcome)).toEqual(['failed', 'published'])
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('publishes two live Portals in the order given', async () => {
    const { first, second } = await seedTwo()

    const results = await wire().publishMany(
      { portals: [{ portalId: second.portal }, { portalId: first.portal }] },
      ctxOf(ORG_A),
    )

    expect(results.map((r) => [r.portalId, r.outcome])).toEqual([
      [second.portal, 'published'],
      [first.portal, 'published'],
    ])
    // The results above carry the order. Both facts can share one created_at,
    // and outbox rows have no insertion order to break the tie, so the facts
    // are compared as a set.
    expect([...(await publishedOrder(ORG_A))].sort()).toEqual(
      [second.portal, first.portal].sort(),
    )
  })

  it('goes on to the next Portal after a store conflict on the first', async () => {
    const { first, second } = await seedTwo()
    // The Portal row moves between the read and the write of the first publication.
    const conflicting = wire({
      wrapStore: (store) => ({
        ...store,
        republishPortal: async (command) => {
          if (command.portalId === first.portal) {
            await getPool().query(
              `UPDATE portals SET updated_at = updated_at + interval '1 second'
                WHERE organization_id = $1 AND id = $2`,
              [ORG_A, first.portal],
            )
          }
          return store.republishPortal(command)
        },
      }),
    })

    const results = await conflicting.publishMany(
      { portals: [{ portalId: first.portal }, { portalId: second.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.portal,
        outcome: 'failed',
        code: 'revision_conflict',
      }),
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
    expect(await snapshotsOf(first)).toHaveLength(1)
  })

  it('goes on to the next Portal after a readiness gate refuses the first', async () => {
    const { first, second } = await seedTwo(['none', 'current'])

    const results = await wire().publishMany(
      { portals: [{ portalId: first.portal }, { portalId: second.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: first.portal,
        outcome: 'failed',
        code: 'token_unavailable',
      }),
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
  })

  it('refuses a ticked Portal that changed after it was reviewed and publishes the others', async () => {
    const { first, second } = await seedTwo()

    const results = await wire().publishMany(
      {
        portals: [
          { portalId: first.portal, reviewedDigest: 'digest-of-an-earlier-draft' },
          { portalId: second.portal },
        ],
      },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      {
        portalId: first.portal,
        outcome: 'failed',
        code: 'revision_conflict',
        message:
          'The Portal changed after you reviewed it. Review the changes again before publishing',
      },
      expect.objectContaining({ portalId: second.portal, outcome: 'published' }),
    ])
    expect(await publishedOrder(ORG_A)).toEqual([second.portal])
  })

  it('publishes a ticked Portal whose reviewed digest still matches', async () => {
    const { first } = await seedTwo()
    const reviewedDigest = buildPortalPublicationSnapshot({
      id: randomUUID(),
      portalId: first.portal,
      organizationId: first.org,
      propertyId: first.property,
      version: 2,
      source: await sourceOf(first),
      destination: LIVE_DESTINATION,
      createdBy: MANAGER,
      createdAt: NOW,
    }).configurationDigest

    const results = await wire().publishMany(
      { portals: [{ portalId: first.portal, reviewedDigest }] },
      ctxOf(ORG_A),
    )

    expect(results).toEqual([
      expect.objectContaining({ portalId: first.portal, outcome: 'published' }),
    ])
  })

  it('reports a Portal with nothing pending as unchanged', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().publishMany({ portals: [{ portalId: live.portal }] }, ctxOf(ORG_A)),
    ).resolves.toEqual([{ portalId: live.portal, outcome: 'unchanged', version: 1 }])
  })

  it('names each Portal once, in the order given', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }, { portalId: live.portal }] },
      ctxOf(ORG_A),
    )

    expect(results).toHaveLength(1)
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('does not hide a fault that is not a Portal error', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const faulty = wire({
      wrapStore: (store) => ({
        ...store,
        republishPortal: async () => {
          throw new Error('connection reset')
        },
      }),
    })

    await expect(
      faulty.publishMany({ portals: [{ portalId: live.portal }] }, ctxOf(ORG_A)),
    ).rejects.toThrow('connection reset')
  })

  it('reports a Portal of another organization as not found and leaves it alone', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const results = await wire().publishMany(
      { portals: [{ portalId: live.portal }] },
      ctxOf(ORG_B),
    )

    expect(results).toEqual([
      expect.objectContaining({
        portalId: live.portal,
        outcome: 'failed',
        code: 'portal_not_found',
      }),
    ])
    await expectNothingWritten(live)
  })
})

describe.sequential('previewPortalChanges (real PostgreSQL, two tenants)', () => {
  it('says what a publication would write and writes nothing', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    const result = await wire().preview({ portalId: live.portal }, ctxOf(ORG_A))

    expect(result).toEqual({ outcome: 'would_publish', version: 2, pendingEdits: 1 })
    await expectNothingWritten(live)
  })

  it('reads nothing pending as unchanged', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toEqual({ outcome: 'unchanged', version: 1, pendingEdits: 0 })
  })

  it("counts the manager's open unpublished edits, so a caller can tell a draft from a bare upgrade", async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 3)

    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'would_publish', pendingEdits: 3 })
  })

  it.each(READINESS_GATES.map((gate) => [gate.key, gate] as const))(
    'refuses what the real publication refuses (%s), so a dry run predicts the apply',
    async (_key, gate) => {
      const live = await seedReady(ORG_A, gate.seed)
      await openChanges(live, 1)
      await gate.sabotage?.(live)
      const stack = wire(gate.wire)

      await expect(
        stack.preview({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: gate.code })
      await expect(
        stack.publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).rejects.toMatchObject({ code: gate.code })
    },
  )

  it('refuses a Portal that is not live, a role that cannot edit Portals and another organization', async () => {
    const draft = await seedReady(ORG_A)
    await openChanges(draft, 1)
    await setState(draft, 'draft')
    await expect(
      wire().preview({ portalId: draft.portal }, ctxOf(ORG_A)),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })

    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      wire().preview({ portalId: live.portal }, ctxOf(ORG_B)),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
