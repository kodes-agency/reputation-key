// Publish changes while live, preview them, make an earlier version live again
// and complete a content review, on real PostgreSQL with two organizations: the
// results a manager sees, the refusals, the snapshots and activations written
// and the facts recorded. The real use cases run over the real stores and
// command store; only the clock, the ids and the other contexts' answers (the
// Property's destination and lifecycle, the staff assignments) are fixed.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot.server'
import { seedLegacySnapshot } from './portal-legacy-live-seed.test-fixtures'
import {
  EDITED_AT,
  LIVE_DESTINATION,
  MANAGER,
  NOW,
  ORG_A,
  ORG_B,
  READINESS_GATES,
  RELINKED_DESTINATION,
  UNAVAILABLE_DESTINATION,
  activationsOf,
  ctxOf,
  expectNothingWritten,
  expectPublishRefused,
  factsOf,
  getPool,
  giveAddress,
  portalRow,
  rewordWelcome,
  scopeOf,
  seedDraft,
  seedReady,
  seedWordmarkOverride,
  setState,
  setupLifecycleDb,
  snapshotsOf,
  sourceOf,
  wire,
  type Live,
} from './portal-publication-lifecycle.test-fixtures'
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

describe.sequential('publishPortalChanges (real PostgreSQL, two tenants)', () => {
  it('replaces the live version with a new immutable one when the draft has moved', async () => {
    const live = await seedReady(ORG_A)
    const before = await portalRow(live)
    await rewordWelcome(live, 'Hotel Test, renewed')

    const result = await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    expect(result).toMatchObject({ outcome: 'published', version: 2, activatedAt: NOW })
    const [first, second] = await snapshotsOf(live)
    expect(second).toMatchObject({
      version: 2,
      created_by: MANAGER,
      created_at: NOW,
      destination_uri: LIVE_DESTINATION.uri,
    })
    expect(second.configuration_digest).not.toBe(first.configuration_digest)
    expect(await activationsOf(live)).toEqual([
      expect.objectContaining({
        activation_sequence: 1,
        deactivated_at: NOW,
        deactivation_reason: 'replaced',
      }),
      expect.objectContaining({
        snapshot_id: second.id,
        activation_sequence: 2,
        kind: 'publish',
        activated_by: MANAGER,
        activated_at: NOW,
        deactivated_at: null,
        deactivation_reason: null,
      }),
    ])
    const after = await portalRow(live)
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    expect(after.publication_state).toBe('published')
    const updated = await factsOf(ORG_A, 'portal.updated')
    expect(updated).toHaveLength(1)
    expect(updated[0]?.payload).toMatchObject({
      previousPublicationState: 'published',
      publicationState: 'published',
    })
  })

  describe('a personal Portal whose staff name is in a wordmark', () => {
    const NAME = 'Marco Rossi'

    it('publishes and republishes when the name is only in the Property brand', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await getPool().query(
        `UPDATE property_portal_brand_profiles SET wordmark = 'Pizzeria Marco'
          WHERE organization_id = $1 AND property_id = $2`,
        [ORG_A, live.property],
      )

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'published', version: 2 })
      await expect(
        wire({ destination: RELINKED_DESTINATION }).publish(
          { portalId: live.portal },
          ctxOf(ORG_A),
        ),
      ).resolves.toMatchObject({ outcome: 'published', version: 3 })
    })

    it('refuses the name in a wordmark the Portal wrote itself and writes nothing', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await seedWordmarkOverride(live)

      await expectPublishRefused(live, 'personal_portal_name_private')
    })

    it('still refuses the name in the Portal wording', async () => {
      const live = await seedReady(ORG_A, { personalName: NAME })
      await getPool().query(
        `INSERT INTO portal_localized_overrides
           (id, organization_id, property_id, portal_id, locale, title,
            short_description, hero_image_url, linktree_title, version, updated_by,
            created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'en', 'Ask Marco', 'Rate your visit.',
                 NULL, NULL, 1, 'seed-manager', $4, $4)`,
        [ORG_A, live.property, live.portal, EDITED_AT],
      )

      await expectPublishRefused(live, 'personal_portal_name_private')
    })
  })

  it('records one publication fact that quotes the new snapshot and nothing of its content', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 2)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const [, second] = await snapshotsOf(live)
    const facts = await factsOf(ORG_A)
    expect(facts.map((row) => row.event_type).sort()).toEqual([
      'portal.publication.published',
      'portal.updated',
    ])
    expect(
      facts.find((row) => row.event_type === 'portal.publication.published')?.payload,
    ).toMatchObject({
      publicationSnapshotId: second.id,
      publicationVersion: 2,
      publicationDigest: second.configuration_digest,
      userId: MANAGER,
    })
    expect(JSON.stringify(facts)).not.toContain(LIVE_DESTINATION.uri)
  })

  it('resolves the recorded changes against the new snapshot', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 2)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const [, second] = await snapshotsOf(live)
    const pending = await getPool().query(
      `SELECT resolved_snapshot_id FROM portal_pending_content_changes
       WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, live.portal],
    )
    expect(pending.rows).toEqual([
      { resolved_snapshot_id: second.id },
      { resolved_snapshot_id: second.id },
    ])
  })

  it('publishes when the reviewed digest is the one the draft produces now', async () => {
    const live = await seedReady(ORG_A)
    await rewordWelcome(live, 'Hotel Test, renewed')
    const reviewedDigest = buildPortalPublicationSnapshot({
      id: randomUUID(),
      portalId: live.portal,
      organizationId: live.org,
      propertyId: live.property,
      version: 2,
      source: await sourceOf(live),
      destination: LIVE_DESTINATION,
      createdBy: MANAGER,
      createdAt: NOW,
    }).configurationDigest

    const result = await wire().publish(
      { portalId: live.portal, reviewedDigest },
      ctxOf(ORG_A),
    )

    expect(result).toMatchObject({
      outcome: 'published',
      configurationDigest: reviewedDigest,
    })
    expect(await snapshotsOf(live)).toHaveLength(2)
  })

  it('refuses and writes nothing when the draft no longer says what was reviewed', async () => {
    const live = await seedReady(ORG_A)
    await rewordWelcome(live, 'Hotel Test, renewed')

    await expect(
      wire().publish(
        { portalId: live.portal, reviewedDigest: 'digest-of-an-earlier-draft' },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await expectNothingWritten(live)
  })

  it('does nothing when nothing is pending', async () => {
    const live = await seedReady(ORG_A)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toEqual({
      outcome: 'unchanged',
      version: 1,
    })
    await expectNothingWritten(live)
  })

  it('republishes a draft that matches the live content when the Property destination was relinked', async () => {
    const live = await seedReady(ORG_A)

    const result = await wire({ destination: RELINKED_DESTINATION }).publish(
      { portalId: live.portal },
      ctxOf(ORG_A),
    )

    expect(result).toMatchObject({ outcome: 'published', version: 2 })
    expect((await snapshotsOf(live))[1]).toMatchObject({
      destination_uri: RELINKED_DESTINATION.uri,
      destination_source_epoch: RELINKED_DESTINATION.sourceEpoch,
    })
  })

  it('still runs the readiness gates for a relink-only republish', async () => {
    const live = await seedReady(ORG_A, { address: 'none' })

    await expectPublishRefused(live, 'token_unavailable', {
      destination: RELINKED_DESTINATION,
    })
  })

  it('publishes when only a recorded change is pending', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'published', version: 2 })
  })

  it('treats a live version of the earlier design as a pending change', async () => {
    const live = await seedDraft(ORG_A)
    await setState(live, 'published')
    await seedLegacySnapshot({
      ...scopeOf(live),
      idTail: 7_310_000 + Math.floor(Math.random() * 1_000_000),
      version: 1,
      schemaVersion: 2,
      at: new Date('2026-08-26T11:00:00.000Z'),
      activation: 'open',
    })
    await giveAddress(live)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).resolves.toMatchObject({ outcome: 'published', version: 2 })
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'refuses a %s Portal, which publishing (not republishing) takes live',
    async (state) => {
      const live = await seedReady(ORG_A)
      await openChanges(live, 1)
      await setState(live, state)

      await expectPublishRefused(live, 'invalid_publication_transition')
    },
  )

  it('refuses a published Portal that has no live version to replace', async () => {
    const live = await seedDraft(ORG_A)
    await setState(live, 'published')
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(await snapshotsOf(live)).toEqual([])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a role that cannot edit Portals', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)

    await expect(
      wire().publish({ portalId: live.portal }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expectNothingWritten(live)
  })

  it('refuses an unknown Portal and a Portal of another organization', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const { publish } = wire()

    await expect(publish({ portalId: randomUUID() }, ctxOf(ORG_A))).rejects.toMatchObject(
      { code: 'portal_not_found' },
    )
    await expect(publish({ portalId: live.portal }, ctxOf(ORG_B))).rejects.toMatchObject({
      code: 'portal_not_found',
    })
    await expectNothingWritten(live)
  })

  describe('readiness gates, the same as for a first publication', () => {
    it.each(READINESS_GATES.map((gate) => [gate.title, gate] as const))(
      '%s',
      async (_title, gate) => {
        const live = await seedReady(ORG_A, gate.seed)
        await openChanges(live, 1)
        await gate.sabotage?.(live)

        await expectPublishRefused(live, gate.code, gate.wire)
      },
    )

    it('publishes over an older code, which guests still open', async () => {
      const live = await seedReady(ORG_A, { address: 'older' })
      await openChanges(live, 1)

      await expect(
        wire().publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'published' })
    })

    it('stops at a blocker in the primary language, as a first publication does', async () => {
      const live = await seedReady(ORG_A)
      await getPool().query(
        `DELETE FROM property_portal_brand_contents
          WHERE organization_id = $1 AND property_id = $2`,
        [ORG_A, live.property],
      )

      await expectPublishRefused(live, 'publication_snapshot_unavailable')
    })

    it('asks nothing of a Portal with nothing to publish', async () => {
      const live = await seedReady(ORG_A)

      await expect(
        wire({
          propertyActive: false,
          destination: UNAVAILABLE_DESTINATION,
        }).publish({ portalId: live.portal }, ctxOf(ORG_A)),
      ).resolves.toMatchObject({ outcome: 'unchanged' })
    })
  })

  it('never rewrites the Portal row itself beyond its revision, and keeps it published', async () => {
    const live = await seedReady(ORG_A)
    await openChanges(live, 1)
    const before = await portalRow(live)

    await wire().publish({ portalId: live.portal }, ctxOf(ORG_A))

    const after = await portalRow(live)
    expect({ ...after, updated_at: null }).toEqual({ ...before, updated_at: null })
    expect(after.publication_state).toBe('published')
  })
})
