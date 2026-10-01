// Republish every live v1/v2 Portal as v3 (round 4, slice 46), end to end on
// real PostgreSQL: the selection, the ordinary publish-while-live use case, the
// command store's transaction and the facts. What it proves that the unit tests
// cannot: the live activation really closes as `replaced`, the new version is a
// verified v3 the guest reader serves, the actor on every row is the operator,
// a second run changes nothing, and a Portal that is draft-only, not ready or
// in another organisation is left exactly as it was.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { PropertyId } from '#/shared/domain/ids'
import {
  previewPortalChanges,
  publishPortalChanges,
  type PublishPortalChangesDeps,
} from '../application/use-cases/publish-portal-changes'
import { republishLegacyPortals } from '../application/use-cases/republish-legacy-portals'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalLegacyPublicationReader } from './repositories/portal-legacy-publication.reader'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import { seedLegacySnapshot } from './testing/portal-legacy-live-seed'
import {
  COMPLETE_SCENARIO,
  INCOMPLETE_SCENARIO,
  NO_BRAND_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'

const READY = COMPLETE_SCENARIO
/** Published on the old design, but its public address is gone: not ready. */
const NO_ADDRESS = NO_BRAND_SCENARIO
/** Never published: a draft. */
const DRAFT = INCOMPLETE_SCENARIO
const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')
const RUN_AT = new Date('2026-10-01T09:00:00.000Z')
const OPERATOR = 'denev'
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=legacy-republish',
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

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedPortalWorkingCopy(getPool(), READY)
  await seedPortalWorkingCopy(getPool(), NO_ADDRESS)
  await seedPortalWorkingCopy(getPool(), DRAFT)
  for (const [seed, tail] of [
    [READY, 1],
    [NO_ADDRESS, 2],
  ] as const) {
    await getPool().query(
      `UPDATE portals SET publication_state = 'published', updated_at = $3
        WHERE organization_id = $1 AND id = $2`,
      [WORKING_COPY_ORG, seed.portalId, PUBLISHED_AT],
    )
    await seedLegacySnapshot({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      portalId: seed.portalId,
      idTail: tail,
      version: 1,
      schemaVersion: tail === 1 ? 1 : 2,
      at: PUBLISHED_AT,
      activation: 'open',
    })
  }
})

function harness(
  options: { onlyProperty?: PropertyId; includePendingEdits?: boolean } = {},
) {
  const db = getDb()
  const deps: PublishPortalChangesDeps = {
    portalRepo: createPortalRepository(db),
    commandStore: createAtomicPortalCommandStore(db),
    publicationRepo: createPortalPublicationRepository(db),
    portalTokenRepo: {
      findResolvableSummaryForPortal: async (_org, portal) =>
        String(portal) === NO_ADDRESS.portalId
          ? null
          : {
              version: 1,
              issuedAt: SEEDED_AT,
              gracePeriodEnds: null,
              hasPublishedAccessArtifact: true,
              addressKeyVersion: null,
            },
    },
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => DESTINATION,
    },
    propertyLifecycleApi: { isPropertyActive: async () => true },
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    idGen: () => randomUUID(),
    clock: () => RUN_AT,
  }
  const run = republishLegacyPortals({
    reader: createPortalLegacyPublicationReader(db),
    publishPortalChanges: publishPortalChanges(deps),
    previewPortalChanges: previewPortalChanges(deps),
    logger: createMockLogger(),
  })
  return (dryRun: boolean) =>
    run({
      organizationId: WORKING_COPY_ORG,
      propertyId: options.onlyProperty,
      operatorId: OPERATOR,
      dryRun,
      includePendingEdits: options.includePendingEdits,
      pageSize: 10,
    })
}

const activations = async (portalId: string) =>
  (
    await getPool().query(
      `SELECT a.activation_sequence AS sequence, s.version,
              s.configuration->>'schemaVersion' AS schema, a.kind, a.activated_by,
              s.created_by, a.deactivated_at, a.deactivation_reason
         FROM portal_publication_activations a
         JOIN portal_publication_snapshots s ON s.id = a.snapshot_id
        WHERE a.organization_id = $1 AND a.portal_id = $2
        ORDER BY a.activation_sequence`,
      [WORKING_COPY_ORG, portalId],
    )
  ).rows

const portalState = async (portalId: string) =>
  (
    await getPool().query(
      `SELECT publication_state FROM portals WHERE organization_id = $1 AND id = $2`,
      [WORKING_COPY_ORG, portalId],
    )
  ).rows[0]?.publication_state

/** A manager's unpublished edit: an open row in the pending-change ledger. */
const seedPendingEdit = async (portal: typeof READY, count = 1) => {
  for (let index = 0; index < count; index++) {
    await getPool().query(
      `INSERT INTO portal_pending_content_changes
         (organization_id, property_id, portal_id, change_kind, change_key,
          source_version, changed_at)
       VALUES ($1, $2, $3, 'portal_links', 'all', $4, $5)`,
      [WORKING_COPY_ORG, portal.propertyId, portal.portalId, `edit-${index}`, SEEDED_AT],
    )
  }
}

const openPendingEdits = async (portalId: string) =>
  Number(
    (
      await getPool().query(
        `SELECT count(*) AS n FROM portal_pending_content_changes
          WHERE organization_id = $1 AND portal_id = $2 AND resolved_at IS NULL`,
        [WORKING_COPY_ORG, portalId],
      )
    ).rows[0]?.n,
  )

/** The read-only fleet SQL the operator runbook documents, taken from the doc itself. */
const documentedFleetSql = (): string => {
  const doc = readFileSync(
    resolve(__dirname, '../../../../docs/operations/operator-commands.md'),
    'utf8',
  )
  const block = /```sql\n(\s*-- live-legacy-portals-by-organization\n[\s\S]*?)```/u.exec(
    doc,
  )
  if (!block?.[1]) throw new Error('the fleet SQL is missing from operator-commands.md')
  return block[1]
}

const outboxCount = async () =>
  Number(
    (
      await getPool().query(
        `SELECT count(*) AS n FROM outbox_events WHERE organization_id = $1`,
        [WORKING_COPY_ORG],
      )
    ).rows[0]?.n,
  )

describe.sequential('republishLegacyPortals (real PostgreSQL)', () => {
  it('a dry run reports what the apply would do and writes nothing', async () => {
    const report = await harness()(true)

    expect(report.mode).toBe('dry_run')
    expect(report.rows.map((row) => [row.portalId, row.outcome])).toEqual([
      [READY.portalId, 'would_republish'],
      [NO_ADDRESS.portalId, 'skipped'],
    ])
    expect(await activations(READY.portalId)).toHaveLength(1)
    expect(await outboxCount()).toBe(0)
  })

  it('republishes the ready Portal as a verified v3, closes the old activation as replaced and names the operator', async () => {
    const report = await harness()(false)

    expect(report.totals).toMatchObject({ processed: 2, republished: 1, skipped: 1 })
    expect(await activations(READY.portalId)).toEqual([
      {
        sequence: 1,
        version: 1,
        schema: '1',
        kind: 'publish',
        activated_by: 'manager-legacy-seed',
        created_by: 'manager-legacy-seed',
        deactivated_at: RUN_AT,
        deactivation_reason: 'replaced',
      },
      {
        sequence: 2,
        version: 2,
        schema: '3',
        kind: 'publish',
        activated_by: `ops:${OPERATOR}`,
        created_by: `ops:${OPERATOR}`,
        deactivated_at: null,
        deactivation_reason: null,
      },
    ])
    expect(await portalState(READY.portalId)).toBe('published')
    const live = await createPortalPublicationRepository(getDb()).findActiveForPortal(
      READY.organizationId,
      READY.portalId,
    )
    expect(live?.version).toBe(2)
    expect(live?.configuration.schemaVersion).toBe(3)
    const facts = await getPool().query(
      `SELECT event_type, payload->>'userId' AS actor FROM outbox_events
        WHERE organization_id = $1 ORDER BY event_type`,
      [WORKING_COPY_ORG],
    )
    expect(facts.rows).toEqual([
      { event_type: 'portal.publication.published', actor: `ops:${OPERATOR}` },
      { event_type: 'portal.updated', actor: null },
    ])
  })

  it('skips a Portal that is not ready, says why and leaves it as it was', async () => {
    const report = await harness()(false)

    expect(report.rows.find((row) => row.portalId === NO_ADDRESS.portalId)).toMatchObject(
      {
        outcome: 'skipped',
        fromSchemaVersion: 2,
        reason: { code: 'token_unavailable' },
      },
    )
    expect(await activations(NO_ADDRESS.portalId)).toEqual([
      expect.objectContaining({
        sequence: 1,
        schema: '2',
        deactivated_at: null,
        deactivation_reason: null,
      }),
    ])
  })

  it("does not push a manager's unpublished edits live: the Portal is skipped and stays on its old page", async () => {
    await seedPendingEdit(READY, 2)

    const dry = await harness()(true)
    const applied = await harness()(false)

    for (const report of [dry, applied]) {
      expect(report.rows.find((row) => row.portalId === READY.portalId)).toMatchObject({
        outcome: 'skipped',
        reason: { code: 'pending_edits' },
      })
    }
    expect(applied.totals).toMatchObject({ republished: 0, skipped: 2 })
    expect(await activations(READY.portalId)).toEqual([
      expect.objectContaining({
        sequence: 1,
        schema: '1',
        deactivated_at: null,
        deactivation_reason: null,
      }),
    ])
    expect(await openPendingEdits(READY.portalId)).toBe(2)
    expect(await outboxCount()).toBe(0)
  })

  it('publishes them when the operator explicitly includes them, and resolves the edits', async () => {
    await seedPendingEdit(READY, 2)

    const report = await harness({ includePendingEdits: true })(false)

    expect(report.rows.find((row) => row.portalId === READY.portalId)).toMatchObject({
      outcome: 'republished',
      pendingEdits: 2,
    })
    expect(await activations(READY.portalId)).toHaveLength(2)
    expect(await openPendingEdits(READY.portalId)).toBe(0)
  })

  it('the documented fleet SQL lists the organisations with live v1/v2 Portals, and none once they are republished', async () => {
    const before = await getPool().query(documentedFleetSql())
    expect(before.rows).toEqual([
      {
        organization_id: WORKING_COPY_ORG,
        live_legacy_portals: '2',
        v1: '1',
        v2: '1',
      },
    ])

    await harness({ includePendingEdits: true })(false)
    const after = await getPool().query(documentedFleetSql())

    // The Portal that is not ready stays on its v2 page; the ready one moved to v3.
    expect(after.rows).toEqual([
      {
        organization_id: WORKING_COPY_ORG,
        live_legacy_portals: '1',
        v1: '0',
        v2: '1',
      },
    ])
  })

  it('never touches a draft-only Portal', async () => {
    await harness()(false)

    expect(await portalState(DRAFT.portalId)).toBe('draft')
    expect(await activations(DRAFT.portalId)).toEqual([])
  })

  it('is idempotent: a second apply republishes nothing and writes nothing', async () => {
    await harness()(false)
    const factsAfterFirst = await outboxCount()

    const second = await harness()(false)

    expect(second.totals).toMatchObject({ processed: 1, republished: 0, skipped: 1 })
    expect(await activations(READY.portalId)).toHaveLength(2)
    expect(await outboxCount()).toBe(factsAfterFirst)
  })

  it('narrows to one Property', async () => {
    const report = await harness({ onlyProperty: NO_ADDRESS.propertyId })(false)

    expect(report.rows.map((row) => row.portalId)).toEqual([NO_ADDRESS.portalId])
    expect(await activations(READY.portalId)).toHaveLength(1)
  })
})
