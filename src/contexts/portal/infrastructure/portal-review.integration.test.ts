// Review & publish (round 4, slice 31) against real PostgreSQL: the change list
// comes from the page-edit ledger and the pending-change fence a real write
// leaves behind, read from the instant the newest version was published, and a
// republish takes every one of them.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { userId } from '#/shared/domain/ids'
import { portalPublicationPublished, portalUpdated } from '../domain/events'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { getPortalReview } from '../application/use-cases/get-portal-review'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { recordPortalContentChange } from './portal-page-edits'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalHistoryRepository } from './repositories/portal-history.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'

const SCENARIO = COMPLETE_SCENARIO
const MANAGER = userId('manager-review-0000000000000001')
const EDITOR = 'editor-review-00000000000000001'
const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')
const EDITED_AT = new Date('2026-08-26T12:00:00.000Z')
const REPUBLISH_AT = new Date('2026-08-26T13:00:00.000Z')
const NOW = new Date('2026-08-26T14:00:00.000Z')
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=review',
  retrievedAt: SEEDED_AT,
  sourceEpoch: 1,
  profileVersion: 1,
} as const

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_activations',
    'portal_publication_snapshots',
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

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const store = () => createAtomicPortalCommandStore(getDb())
const publicationRepo = () => createPortalPublicationRepository(getDb())

async function snapshotOfDraft(id: string, version: number, at: Date) {
  const source = await publicationRepo().loadWorkingCopy(
    SCENARIO.organizationId,
    SCENARIO.portalId,
  )
  if (!source) throw new Error('the scenario has no working copy')
  return buildPortalPublicationSnapshot({
    id,
    portalId: SCENARIO.portalId,
    organizationId: SCENARIO.organizationId,
    propertyId: SCENARIO.propertyId,
    version,
    source,
    destination: DESTINATION,
    createdBy: MANAGER,
    createdAt: at,
  })
}

const scope = {
  organizationId: SCENARIO.organizationId,
  propertyId: SCENARIO.propertyId,
  portalId: SCENARIO.portalId,
}

const facts = (
  snapshot: { id: string; version: number; configurationDigest: string },
  at: Date,
) => ({
  lifecycleEvent: portalPublicationPublished({
    ...scope,
    publicationSnapshotId: snapshot.id,
    publicationVersion: snapshot.version,
    publicationDigest: snapshot.configurationDigest,
    userId: MANAGER,
    sourceAggregateVersion: at.toISOString(),
    occurredAt: at,
  }),
})

async function publishFirstVersion(): Promise<void> {
  const snapshot = await snapshotOfDraft(
    '6d100000-0000-4000-8000-000000000001',
    1,
    PUBLISHED_AT,
  )
  await store().updatePortal({
    ...scope,
    actorUserId: MANAGER,
    expectedUpdatedAt: SEEDED_AT,
    revision: PUBLISHED_AT,
    occurredAt: PUBLISHED_AT,
    patch: { publicationState: 'published' },
    publication: {
      kind: 'publish',
      snapshot,
      activation: {
        id: '6e100000-0000-4000-8000-000000000001',
        organizationId: SCENARIO.organizationId,
        propertyId: SCENARIO.propertyId,
        portalId: SCENARIO.portalId,
        snapshotId: snapshot.id,
        activationSequence: 1,
        kind: 'publish',
        activatedBy: MANAGER,
        activatedAt: PUBLISHED_AT,
        deactivatedAt: null,
        deactivationReason: null,
      },
    },
    ...facts(snapshot, PUBLISHED_AT),
    event: portalUpdated({
      portalId: SCENARIO.portalId,
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: PUBLISHED_AT.toISOString(),
      occurredAt: PUBLISHED_AT,
    }),
  })
}

/** The Property rewords its Bulgarian welcome title, the way a real save records it. */
async function rewordWelcome(title: string, at: Date): Promise<void> {
  await getPool().query(
    `UPDATE property_portal_brand_contents SET title = $2
      WHERE property_id = $1 AND locale = 'bg'`,
    [SCENARIO.propertyId, title],
  )
  await getDb().transaction((tx) =>
    recordPortalContentChange(tx, {
      organizationId: SCENARIO.organizationId,
      propertyId: SCENARIO.propertyId,
      portalIds: [SCENARIO.portalId],
      kind: 'property_brand_content',
      key: 'bg',
      ledger: [{ key: 'bg', previousText: 'Хотел Рила', newText: title }],
      sourceVersion: `welcome-${at.toISOString()}`,
      changedAt: at,
      actorUserId: EDITOR,
    }),
  )
}

const review = () =>
  getPortalReview({
    portalRepo: createPortalRepository(getDb()),
    portalLinkRepo: createPortalLinkRepository(getDb(), () => NOW),
    experienceRepo: createPortalExperienceRepository(getDb()),
    publicationRepo: publicationRepo(),
    historyRepo: createPortalHistoryRepository(getDb()),
    actorDirectory: {
      resolveDisplayNames: async () => new Map([[userId(EDITOR), 'Elena Petrova']]),
    },
    portalTokenRepo: {
      findResolvableSummaryForPortal: async () => ({
        version: 1,
        issuedAt: SEEDED_AT,
        gracePeriodEnds: null,
        hasPublishedAccessArtifact: true,
        addressKeyVersion: null,
      }),
    },
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => DESTINATION,
    },
    propertyLifecycleApi: { isPropertyActive: async () => true },
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  })(
    { portalId: SCENARIO.portalId },
    buildTestAuthContext({
      organizationId: SCENARIO.organizationId,
      role: 'AccountAdmin',
    }),
  )

describe.sequential('getPortalReview (real PostgreSQL)', () => {
  beforeEach(async () => {
    await seedPortalWorkingCopy(getPool(), SCENARIO)
    await publishFirstVersion()
  })

  it('has nothing to publish straight after a publication', async () => {
    const result = await review()

    expect(result).toMatchObject({
      action: 'publish_changes',
      live: { version: 1, activatedBy: { userId: MANAGER } },
      publishesAsVersion: 2,
      nothingToPublish: true,
      canPublish: false,
      changes: [],
    })
  })

  it('lists a real edit with its person, wording and time, and offers to publish it', async () => {
    await rewordWelcome('Хотел Рила, обновен', EDITED_AT)

    const result = await review()

    expect(result.nothingToPublish).toBe(false)
    expect(result.canPublish).toBe(true)
    expect(result.checkCounts.blocked).toBe(0)
    expect(result.changes).toEqual([
      {
        type: 'edit',
        kind: 'property_brand_content',
        subject: { area: 'welcome_text', locale: 'bg' },
        propertyWide: true,
        actor: { userId: EDITOR, displayName: 'Elena Petrova' },
        occurredAt: EDITED_AT.toISOString(),
        previousText: 'Хотел Рила',
        newText: 'Хотел Рила, обновен',
        editCount: 1,
      },
    ])
  })

  it('does not list a wording that was changed and put back', async () => {
    await rewordWelcome('Хотел Рила, обновен', EDITED_AT)
    await rewordWelcome('Хотел Рила', new Date(EDITED_AT.getTime() + 60 * 60_000))

    const result = await review()

    // The fence is still open and the ledger kept both saves: they cancel out
    // and the draft says what is live, so the page says publishing changes
    // nothing guests see (not that unnamed changes exist).
    expect(result.changes).toEqual([{ type: 'no_visible_change' }])
    expect(result.nothingToPublish).toBe(false)
  })

  it('has nothing to list again once the changes are published', async () => {
    await rewordWelcome('Хотел Рила, обновен', EDITED_AT)
    const snapshot = await snapshotOfDraft(
      '6d100000-0000-4000-8000-000000000002',
      2,
      REPUBLISH_AT,
    )
    await store().republishPortal({
      ...scope,
      actorUserId: MANAGER,
      expectedUpdatedAt: PUBLISHED_AT,
      revision: REPUBLISH_AT,
      occurredAt: REPUBLISH_AT,
      snapshot,
      activation: {
        id: '6e100000-0000-4000-8000-000000000002',
        organizationId: SCENARIO.organizationId,
        propertyId: SCENARIO.propertyId,
        portalId: SCENARIO.portalId,
        snapshotId: snapshot.id,
        activationSequence: 2,
        kind: 'publish',
        activatedBy: MANAGER,
        activatedAt: REPUBLISH_AT,
        deactivatedAt: null,
        deactivationReason: null,
      },
      ...facts(snapshot, REPUBLISH_AT),
      event: portalUpdated({
        portalId: SCENARIO.portalId,
        organizationId: SCENARIO.organizationId,
        propertyId: SCENARIO.propertyId,
        previousPublicationState: 'published',
        publicationState: 'published',
        sourceAggregateVersion: REPUBLISH_AT.toISOString(),
        occurredAt: REPUBLISH_AT,
      }),
    })

    const result = await review()

    expect(result).toMatchObject({
      live: { version: 2 },
      publishesAsVersion: 3,
      nothingToPublish: true,
      changes: [],
    })
  })
})
