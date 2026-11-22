// Publish changes while live, preview them, make an earlier version live again
// and complete a content review, on real PostgreSQL with two organizations: the
// results a manager sees, the refusals, the snapshots and activations written
// and the facts recorded. The real use cases run over the real stores and
// command store; only the clock, the ids and the other contexts' answers (the
// Property's destination and lifecycle, the staff assignments) are fixed.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { staffApiOf } from '#/shared/testing/staff-public-api-stub'
import { getDb } from '#/shared/db'
import { completeContentReview } from './complete-content-review.server'
import { createPortalGroupRepository } from '../groups/portal-group-repository.server'
import { createPortalRepository } from './portal-repository.server'
import { createPortalWorkflowFactStore } from './portal-workflow-fact-store.server'
import { seedLegacySnapshot } from './portal-legacy-live-seed.test-fixtures'
import {
  EDITED_AT,
  MANAGER,
  NOW,
  ORG_A,
  ORG_B,
  activationsOf,
  clearFacts,
  ctxOf,
  expectNothingWritten,
  factsOf,
  getPool,
  goLive,
  portalRow,
  publicationFacts,
  republish,
  rewordWelcome,
  scopeOf,
  seedDraft,
  seedLive,
  seedWordmarkOverride,
  setState,
  setupLifecycleDb,
  snapshotsOf,
  wire,
  type DraftOptions,
  type Live,
} from './portal-publication-lifecycle.test-fixtures'

setupLifecycleDb()

describe.sequential('rollbackPortalPublication (real PostgreSQL, two tenants)', () => {
  const admin = (org: OrganizationId = ORG_A) => ctxOf(org, 'AccountAdmin')

  /** Two live versions: the first as published, the second after the welcome was reworded. */
  async function seedTwoVersions(options: DraftOptions = {}): Promise<Live> {
    const live = await seedLive(ORG_A, options)
    await rewordWelcome(live, 'Hotel Test, renewed')
    await republish(live)
    await clearFacts()
    return live
  }

  it.each([1, 2] as const)(
    'refuses retired format %i without writing an activation',
    async (schemaVersion) => {
      const live = await seedDraft(ORG_A)
      await setState(live, 'published')
      const idTail = 7_320_000 + Math.floor(Math.random() * 1_000_000)
      const at = new Date('2026-08-26T11:00:00.000Z')
      await seedLegacySnapshot({
        ...scopeOf(live),
        idTail,
        version: 1,
        schemaVersion,
        at,
        activation: 'replaced',
      })
      await seedLegacySnapshot({
        ...scopeOf(live),
        idTail,
        version: 2,
        schemaVersion,
        at: new Date(at.getTime() + 60_000),
        activation: 'open',
      })

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).rejects.toMatchObject({ code: 'not_restorable' })
      await expectNothingWritten(live, 2)
    },
  )

  describe('a personal Portal whose staff name is in a wordmark', () => {
    it('rolls back when the name is only in the Property brand', async () => {
      const live = await seedLive(ORG_A, {
        personalName: 'Marco Rossi',
        wordmark: 'Pizzeria Marco',
      })
      await rewordWelcome(live, 'Hotel Test, renewed')
      await republish(live)

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).resolves.toMatchObject({ version: 1 })
      expect(await activationsOf(live)).toHaveLength(3)
    })

    it('refuses the name in a wordmark the Portal wrote itself', async () => {
      const live = await seedDraft(ORG_A, { personalName: 'Marco Rossi' })
      await seedWordmarkOverride(live)
      await goLive(live)
      await rewordWelcome(live, 'Hotel Test, renewed')
      await republish(live)
      await clearFacts()

      await expect(
        wire().rollback({ portalId: live.portal, version: 1 }, admin()),
      ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
      await expectNothingWritten(live, 2)
    })
  })

  it('appends an activation for an older immutable version', async () => {
    const live = await seedTwoVersions()
    const [first] = await snapshotsOf(live)
    const before = await portalRow(live)

    await expect(
      wire().rollback({ portalId: live.portal, version: 1 }, admin()),
    ).resolves.toEqual({
      snapshotId: first.id,
      version: 1,
      configurationDigest: first.configuration_digest,
      activatedAt: NOW,
    })

    expect(await snapshotsOf(live)).toHaveLength(2)
    const activations = await activationsOf(live)
    expect(activations).toHaveLength(3)
    expect(activations[1]).toMatchObject({ activation_sequence: 2, deactivated_at: NOW })
    expect(activations[2]).toEqual({
      snapshot_id: first.id,
      activation_sequence: 3,
      kind: 'rollback',
      activated_by: MANAGER,
      activated_at: NOW,
      deactivated_at: null,
      deactivation_reason: null,
    })
    expect(await publicationFacts(ORG_A)).toEqual([
      expect.objectContaining({
        event_type: 'portal.publication.rolled_back',
        payload: expect.objectContaining({
          organizationId: ORG_A,
          propertyId: live.property,
          portalId: live.portal,
          publicationSnapshotId: first.id,
          publicationVersion: 1,
          publicationDigest: first.configuration_digest,
          userId: MANAGER,
          occurredAt: NOW.toISOString(),
        }),
      }),
    ])
    const after = await portalRow(live)
    expect(after.publication_state).toBe('published')
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
  })

  it('makes a later version live again after an earlier one was restored', async () => {
    const live = await seedTwoVersions()
    const { rollback } = wire()
    await rollback({ portalId: live.portal, version: 1 }, admin())
    const [, second] = await snapshotsOf(live)

    await expect(
      rollback({ portalId: live.portal, version: 2 }, admin()),
    ).resolves.toMatchObject({ snapshotId: second.id, version: 2 })

    const activations = await activationsOf(live)
    expect(activations.at(-1)).toMatchObject({
      snapshot_id: second.id,
      kind: 'rollback',
      activation_sequence: 4,
      deactivated_at: null,
    })
  })

  it('refuses to make the version that is already live live again', async () => {
    const live = await seedTwoVersions()

    await expect(
      wire().rollback({ portalId: live.portal, version: 2 }, admin()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    await expectNothingWritten(live, 2)
  })

  it('rejects a version that does not exist for this Portal', async () => {
    const live = await seedTwoVersions()

    await expect(
      wire().rollback({ portalId: live.portal, version: 99 }, admin()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    await expectNothingWritten(live, 2)
  })

  it('never reaches a Portal of another organization or one the role cannot edit', async () => {
    const live = await seedTwoVersions()
    const { rollback } = wire()

    await expect(
      rollback({ portalId: live.portal, version: 1 }, admin(ORG_B)),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    await expect(
      rollback({ portalId: live.portal, version: 1 }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expectNothingWritten(live, 2)
  })

  it('never republishes a disabled Portal as a rollback side effect', async () => {
    const live = await seedTwoVersions()
    await setState(live, 'disabled')

    await expect(
      wire().rollback({ portalId: live.portal, version: 1 }, admin()),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
    await expectNothingWritten(live, 2)
    expect((await portalRow(live)).publication_state).toBe('disabled')
  })
})

describe.sequential('completeContentReview (real PostgreSQL, two tenants)', () => {
  function review(accessible?: PropertyId[]) {
    const db = getDb()
    const groupRepo = createPortalGroupRepository(db)
    return completeContentReview({
      portalRepo: createPortalRepository(db),
      staffPublicApi: staffApiOf(accessible ?? null),
      portalGroupLookup: { findGroupForPortal: groupRepo.findGroupForPortal },
      factStore: createPortalWorkflowFactStore(db),
      clock: () => NOW,
    })
  }

  async function seedGrouped(live: Live) {
    const group = randomUUID()
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Front desk', $4, $4)`,
      [group, live.org, live.property, EDITED_AT],
    )
    await getPool().query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [live.org, live.property, live.portal, group, EDITED_AT, MANAGER],
    )
    return group
  }

  it('records an exact occurrence-time Portal workflow command', async () => {
    const live = await seedLive(ORG_A)
    const group = await seedGrouped(live)
    await clearFacts()

    const result = await review()(
      { portalId: live.portal, reviewId: 'review-1', revision: 1 },
      ctxOf(ORG_A),
    )

    expect(result.status).toBe('recorded')
    const facts = await factsOf(ORG_A)
    expect(facts.map((row) => row.event_type)).toEqual([
      'portal.content_review.completed',
    ])
    for (const fact of facts) {
      expect(fact.payload).toMatchObject({
        organizationId: ORG_A,
        propertyId: live.property,
        portalId: live.portal,
        portalGroupId: group,
        reviewId: 'review-1',
        revision: 1,
        occurredAt: NOW.toISOString(),
      })
    }
  })

  it('passes correction lineage without creating an unrelated review', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()
    const lineage = {
      contentReviewSourceEventId: randomUUID(),
    }

    await review()(
      {
        portalId: live.portal,
        reviewId: 'review-1',
        revision: 2,
        supersedes: lineage,
      },
      ctxOf(ORG_A),
    )

    const facts = await factsOf(ORG_A)
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload.supersedesSourceEventId).toBe(
      lineage.contentReviewSourceEventId,
    )
    for (const fact of facts) {
      expect(fact.payload).toMatchObject({ reviewId: 'review-1', revision: 2 })
    }
  })

  it('rejects cross-property access before recording any fact', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()

    await expect(
      review([])(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('rejects review completion for non-published content', async () => {
    const live = await seedDraft(ORG_A)

    await expect(
      review()(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('does not reach a Portal of another organization', async () => {
    const live = await seedLive(ORG_A)
    await clearFacts()

    await expect(
      review()(
        { portalId: live.portal, reviewId: 'review-1', revision: 1 },
        ctxOf(ORG_B),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })
})
