// A Portal's own look and its publish, against PostgreSQL (ADR 0070). A save
// takes the Property's publication lock and then the Portal row, the order
// publish takes them, so a save waits for a publish of the same Portal to
// commit and never deadlocks with it. A publish after a save rebuilds its
// working copy inside its transaction, finds it unchanged and takes the save's
// pending change with it.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { portalPublicationPublished, portalUpdated } from '../domain/events'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { createAtomicPortalCommandStore } from './portal-command-store'
import {
  lockPortalPublicationProperty,
  lockPortalPublicationWorkingCopy,
} from './portal-publication-serialization'
import { createPortalLookRepository } from './repositories/portal-look.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'

const SCENARIO = COMPLETE_SCENARIO
const ADMIN = userId('admin-portal-look-publish-0000001')
const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')
const SAVED_AT = new Date('2026-08-26T12:00:00.000Z')
const REPUBLISH_AT = new Date('2026-08-26T13:00:00.000Z')
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=look',
  retrievedAt: SEEDED_AT,
  sourceEpoch: 1,
  profileVersion: 1,
} as const
/** How often, and how many times, the test looks for the save waiting on the lock. */
const LOCK_WAIT_POLL_MS = 20
const LOCK_WAIT_POLLS = 250

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_look_overrides',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const scope = {
  organizationId: SCENARIO.organizationId,
  propertyId: SCENARIO.propertyId,
  portalId: SCENARIO.portalId,
}

const store = () => createAtomicPortalCommandStore(getDb())

const saveOwnAccent = () =>
  createPortalLookRepository(getDb()).savePortalLookPart({
    ...scope,
    change: { group: 'colours', mode: 'own', accent: '#2F855A' },
    actorUserId: ADMIN,
    at: SAVED_AT,
  })

/** The snapshot of the working copy as it is now, and the facts its publish records. */
async function publicationOf(version: number, at: Date) {
  const source = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
    SCENARIO.organizationId,
    SCENARIO.portalId,
  )
  if (!source) throw new Error('the scenario has no working copy')
  const n = String(version)
  const snapshot = buildPortalPublicationSnapshot({
    id: `6d700000-0000-4000-8000-00000000000${n}`,
    ...scope,
    version,
    source,
    destination: DESTINATION,
    createdBy: ADMIN,
    createdAt: at,
  })
  return {
    snapshot,
    activation: {
      id: `6e700000-0000-4000-8000-00000000000${n}`,
      ...scope,
      snapshotId: snapshot.id,
      activationSequence: version,
      kind: 'publish' as const,
      activatedBy: ADMIN,
      activatedAt: at,
      deactivatedAt: null,
      deactivationReason: null,
    },
    lifecycleEvent: portalPublicationPublished({
      ...scope,
      publicationSnapshotId: snapshot.id,
      publicationVersion: version,
      publicationDigest: snapshot.configurationDigest,
      userId: ADMIN,
      sourceAggregateVersion: at.toISOString(),
      occurredAt: at,
    }),
  }
}

const updatedEvent = (from: 'draft' | 'published', at: Date) =>
  portalUpdated({
    ...scope,
    previousPublicationState: from,
    publicationState: 'published',
    sourceAggregateVersion: at.toISOString(),
    occurredAt: at,
  })

async function publishFirstVersion(): Promise<void> {
  const { snapshot, activation, lifecycleEvent } = await publicationOf(1, PUBLISHED_AT)
  await store().updatePortal({
    ...scope,
    actorUserId: ADMIN,
    expectedUpdatedAt: SEEDED_AT,
    revision: PUBLISHED_AT,
    occurredAt: PUBLISHED_AT,
    patch: { publicationState: 'published' },
    publication: { kind: 'publish', snapshot, activation },
    lifecycleEvent,
    event: updatedEvent('draft', PUBLISHED_AT),
  })
}

async function republish(): Promise<void> {
  const publication = await publicationOf(2, REPUBLISH_AT)
  await store().republishPortal({
    ...scope,
    ...publication,
    actorUserId: ADMIN,
    expectedUpdatedAt: PUBLISHED_AT,
    revision: REPUBLISH_AT,
    occurredAt: REPUBLISH_AT,
    event: updatedEvent('published', REPUBLISH_AT),
  })
}

const openPendingKeys = async () =>
  (
    await getPool().query(
      `SELECT change_key FROM portal_pending_content_changes
        WHERE organization_id = $1 AND portal_id = $2 AND resolved_at IS NULL`,
      [WORKING_COPY_ORG, SCENARIO.portalId],
    )
  ).rows.map((row) => row.change_key)

/** Whether a statement of this database is waiting on a lock another transaction holds. */
async function isWaitingOnLock(): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%pg_advisory_xact_lock%'`,
  )
  return rows[0].waiting > 0
}

async function untilWaitingOnLock(): Promise<void> {
  for (let poll = 0; poll < LOCK_WAIT_POLLS; poll += 1) {
    if (await isWaitingOnLock()) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
  }
  throw new Error('the save never waited for the publication lock')
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedPortalWorkingCopy(getPool(), SCENARIO)
  await publishFirstVersion()
})

describe.sequential('a Portal’s own look and its publish (real PostgreSQL)', () => {
  it('publishes after a save: the working copy matches inside the transaction', async () => {
    await expect(saveOwnAccent()).resolves.toMatchObject({
      status: 'saved',
      changedFacets: ['accent'],
    })
    await expect(openPendingKeys()).resolves.toEqual(['look:accent'])

    await republish()

    await expect(openPendingKeys()).resolves.toEqual([])
    // What went live is the Portal's own look at the Portal's own version, not the
    // Property's.
    const { rows } = await getPool().query(
      `SELECT s.configuration->'brandProfile' AS brand, s.brand_profile_version AS version,
              o.look_version AS own_version
         FROM portal_publication_snapshots s
         JOIN portal_look_overrides o
           ON o.organization_id = s.organization_id AND o.portal_id = s.portal_id
        WHERE s.organization_id = $1 AND s.portal_id = $2 AND s.version = 2`,
      [WORKING_COPY_ORG, SCENARIO.portalId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].brand).toMatchObject({
      accentColour: '#2F855A',
      lookVersion: rows[0].own_version,
    })
    expect(rows[0].version).toBe(rows[0].own_version)
  })

  it('waits for a publish of the same Portal to commit, then saves', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let markLocked = () => {}
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve
    })
    // The locks a publish holds while it builds and commits its snapshot.
    const publishing = getDb().transaction(async (tx) => {
      await lockPortalPublicationProperty(tx, scope.organizationId, scope.propertyId)
      await lockPortalPublicationWorkingCopy(
        tx,
        scope.organizationId,
        scope.propertyId,
        scope.portalId,
      )
      markLocked()
      await released
    })
    await locked

    let isSettled = false
    const saving = saveOwnAccent().finally(() => {
      isSettled = true
    })
    await untilWaitingOnLock()
    expect(isSettled).toBe(false)

    release()
    await publishing
    await expect(saving).resolves.toMatchObject({ status: 'saved' })
    await expect(openPendingKeys()).resolves.toEqual(['look:accent'])
  })
})
