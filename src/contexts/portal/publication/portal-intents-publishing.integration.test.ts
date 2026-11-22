// Publishing a Portal over the real repositories and the atomic command store on
// PostgreSQL: the snapshot, activation and facts a publish commits, the gates that
// refuse it, and the rating goal that holds the skip-private-rating switch.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { getDb } from '#/shared/db'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/reporting/public-api'
import { isPortalError } from '../domain/errors'
import { reviewedPublicationDigest } from './portal-publication-snapshot.server'
import { createPortalPublicationRepository } from './portal-publication-repository.server'
import { VERIFIED_GOOGLE_DESTINATION } from '../infrastructure/testing/portal-creation-world'
import { codeOf } from './portal-creation-queries.test-fixtures'
import {
  createIntentsHarness,
  INTENT_TABLES,
  manager,
  seedIntentProperties,
  TEST_ORGANIZATIONS,
  world,
  CLOCK,
  GROUP,
  MANAGER,
  NEXT,
  NO_BRAND_PROPERTY,
  NO_WORDING_PROPERTY,
  ORG_A,
  ORG_B,
  PORTAL,
  PROPERTY,
  PROPERTY_B,
} from './portal-intents.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: INTENT_TABLES,
})
const { portalRow, factsOf, snapshotsOf, activationsOf, footprint, seedPortal } =
  createIntentsHarness(getPool)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedIntentProperties(getPool())
})

describe.sequential('publishing', () => {
  it('rejects publishing when the Property has no verified Google destination', async () => {
    const { publish } = world({ destination: 'unavailable' })
    await seedPortal()
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'google_review_destination_unavailable',
    )
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('publishes a rating-first gateway without requiring secondary links', async () => {
    const { publish } = world()
    await seedPortal({ atClock: true })

    const updated = await publish({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('published')
    const [snapshot] = await snapshotsOf()
    expect(snapshot).toMatchObject({
      version: 1,
      configuration: {
        reviewGateway: { privateFeedbackThreshold: 4 },
        links: [],
      },
    })
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ activation_sequence: 1, kind: 'publish' }),
    ])
    expect(await factsOf('portal.publication.published')).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL,
        publicationSnapshotId: snapshot.id,
        publicationVersion: 1,
        publicationDigest: snapshot.configuration_digest,
        userId: MANAGER,
        sourceAggregateVersion: NEXT.toISOString(),
        occurredAt: CLOCK.toISOString(),
      }),
    ])
    expect(snapshot.configuration_digest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('goes live when the draft still says what the manager reviewed', async () => {
    const { publish } = world()
    await seedPortal()
    const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
      ORG_A,
      PORTAL as never,
    )
    const reviewedDigest = reviewedPublicationDigest(
      working!,
      VERIFIED_GOOGLE_DESTINATION,
    )

    expect(reviewedDigest).not.toBeNull()
    const updated = await publish(
      { portalId: PORTAL, reviewedDigest: reviewedDigest as string },
      manager,
    )

    expect(updated.publicationState).toBe('published')
    expect((await snapshotsOf())[0].configuration_digest).toBe(reviewedDigest)
  })

  it('refuses to go live when the draft changed after it was reviewed', async () => {
    const { publish, writes } = world()
    await seedPortal()
    const before = await footprint()

    const error = await publish(
      { portalId: PORTAL, reviewedDigest: 'digest-before-the-edit' },
      manager,
    ).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('revision_conflict')
    expect((error as Error).message).toBe(
      'The Portal changed after you reviewed it. Review the changes again before publishing',
    )
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('publishes the new design: schema version 3, in every language the Portal offers', async () => {
    const { publish } = world()
    await seedPortal({ additional: ['bg'] })

    await publish({ portalId: PORTAL }, manager)

    const [snapshot] = await snapshotsOf()
    expect(snapshot.configuration).toMatchObject({
      schemaVersion: 3,
      localeSet: ['en', 'bg'],
    })
    expect(snapshot.language_pack_versions).toEqual({
      en: 'guest-ui-en-v2',
      bg: 'guest-ui-bg-v2',
    })
  })

  it('publishes a Property that has no brand profile, with the default look', async () => {
    const { publish } = world()
    await seedPortal({ property: NO_BRAND_PROPERTY })

    await publish({ portalId: PORTAL }, manager)

    expect((await snapshotsOf())[0].configuration).toMatchObject({
      schemaVersion: 3,
      brandProfile: { lookVersion: 1 },
    })
  })

  it('refuses to publish when the primary language has no wording, and writes nothing', async () => {
    const { publish, writes } = world()
    await seedPortal({ property: NO_WORDING_PROPERTY })
    const before = await footprint()

    const error = await publish({ portalId: PORTAL }, manager).catch((e: unknown) => e)

    expect(isPortalError(error) && error.code).toBe('publication_snapshot_unavailable')
    expect((error as Error).message).toContain('primary language')
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('fails closed before destination lookup or persistence when the Property is inactive', async () => {
    const { publish, calls, writes } = world({ lifecycle: 'inactive' })
    await seedPortal()
    const before = await footprint()

    await expect(publish({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'portal_inactive',
    })

    expect(calls.lifecycle).toBe(1)
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('fails closed without leaking a lifecycle lookup error or causing downstream effects', async () => {
    const { publish, calls, writes } = world({ lifecycle: 'error' })
    await seedPortal()
    const before = await footprint()

    await expect(publish({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_inactive',
      message: 'This Portal cannot be published while its Property is unavailable',
    })

    expect(calls.lifecycle).toBe(1)
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('keeps deactivation available without lifecycle or destination authority', async () => {
    const { disable, calls } = world({ destination: 'unavailable', lifecycle: 'error' })
    await seedPortal({ state: 'published' })

    const updated = await disable({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('disabled')
    expect(await activationsOf()).toEqual([
      expect.objectContaining({ kind: 'publish', deactivation_reason: 'disabled' }),
    ])
    expect(calls.lifecycle).toBe(0)
    expect(calls.destination).toBe(0)
  })

  it('refuses a publish without a verified destination and persists nothing', async () => {
    const { publish } = world({ destination: 'unavailable' })
    await seedPortal({ description: 'Before' })
    const before = await footprint()

    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe(
      'google_review_destination_unavailable',
    )

    expect(await footprint()).toEqual(before)
    expect(await portalRow()).toMatchObject({
      publication_state: 'draft',
      description: 'Before',
    })
  })

  it('refuses to go live when nobody is responsible or the code does not resolve', async () => {
    const { publish } = world()
    await seedPortal({ withToken: false })
    expect(await codeOf(publish({ portalId: PORTAL }, manager))).toBe('token_unavailable')
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('never consults the destination when the update leaves publication state alone', async () => {
    const { settings, calls } = world()
    await seedPortal({ description: 'Before' })

    const updated = await settings({ portalId: PORTAL, description: 'After' }, manager)

    expect(updated.description).toBe('After')
    expect(updated.publicationState).toBe('draft')
    expect(calls.destination).toBe(0)
  })

  // A portal that is ALREADY published (pre-precondition data) must
  // stay editable: re-asserting the current state is not a transition.
  it('never consults the destination or writes when the Portal is already published', async () => {
    const { publish, calls, writes } = world()
    await seedPortal({ state: 'published' })
    const before = await footprint()

    const updated = await publish({ portalId: PORTAL }, manager)

    expect(updated.publicationState).toBe('published')
    expect(calls.destination).toBe(0)
    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })
})

describe.sequential('skip private rating through the goal port', () => {
  async function seedGoal(
    subject: Readonly<{ kind: 'portal'; portalId: string } | { kind: 'portal_group' }>,
  ) {
    const [programId, versionId] = [randomUUID(), randomUUID()]
    const pool = getPool()
    await pool.query(
      `INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by)
       VALUES ($1, $2, $3, 'Target', 'active', 'test')`,
      [programId, ORG_A, PROPERTY],
    )
    await pool.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version, metric_definition_id,
          metric_definition_version_id, metric_key, metric_minimum_sample, target_value,
          property_timezone, effective_from, change_reason, created_by)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal_rating_count', 0, 25, 'Europe/Sofia', $7,
               'created', 'test')`,
      [
        versionId,
        programId,
        ORG_A,
        PROPERTY,
        METRIC_DEFINITION_IDS.portalRatingCount,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        new Date('2026-09-01T00:00:00.000Z'),
      ],
    )
    await pool.query(
      `INSERT INTO goal_subject_assignments
         (id, program_id, program_version_id, organization_id, property_id, metric_key,
          subject_kind, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'portal_rating_count', $6, $7, $8, $9, 'test')`,
      [
        randomUUID(),
        programId,
        versionId,
        ORG_A,
        PROPERTY,
        subject.kind,
        subject.kind === 'portal' ? subject.portalId : null,
        subject.kind === 'portal_group' ? GROUP : null,
        new Date('2026-09-01T00:00:00.000Z'),
      ],
    )
  }

  it('refuses the switch while this Portal has a running rating goal', async () => {
    const { settings, writes } = world()
    await seedPortal({ state: 'published' })
    await seedGoal({ kind: 'portal', portalId: PORTAL })
    const before = await footprint()

    await expect(
      settings({ portalId: PORTAL, skipPrivateRating: true }, manager),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'running_rating_goal',
      message: 'This portal has a running goal on private ratings. End the goal first.',
    })

    expect(writes()).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it('saves the switch when no single-Portal rating goal holds it', async () => {
    const { settings, writes } = world()
    await seedPortal({ state: 'published' })

    const saved = await settings({ portalId: PORTAL, skipPrivateRating: true }, manager)

    expect(saved.skipPrivateRating).toBe(true)
    expect((await portalRow()).skip_private_rating).toBe(true)
    expect(writes()).toBe(1)
  })

  it('does not let a goal of another organization hold the switch', async () => {
    const { settings } = world()
    await seedPortal({ state: 'published' })
    const pool = getPool()
    await pool.query(
      `INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by)
       VALUES ($1, $2, $3, 'Theirs', 'active', 'test')`,
      [randomUUID(), ORG_B, PROPERTY_B],
    )
    expect(
      (await settings({ portalId: PORTAL, skipPrivateRating: true }, manager))
        .skipPrivateRating,
    ).toBe(true)
  })

  it('shows the wider-goal refusal for the last rating collector', async () => {
    const { settings } = world()
    await seedPortal({ state: 'published' })
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Desk', $4, $4)`,
      [GROUP, ORG_A, PROPERTY, CLOCK],
    )
    await getPool().query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'test')`,
      [ORG_A, PROPERTY, PORTAL, GROUP, new Date('2026-09-01T00:00:00.000Z')],
    )
    await seedGoal({ kind: 'portal_group' })

    await expect(
      settings({ portalId: PORTAL, skipPrivateRating: true }, manager),
    ).rejects.toMatchObject({
      code: 'running_rating_goal',
      message:
        'This is the last portal collecting ratings for a running goal. End the goal first.',
    })
  })
})
