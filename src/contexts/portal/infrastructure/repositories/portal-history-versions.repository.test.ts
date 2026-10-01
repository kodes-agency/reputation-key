// Portal context — the History tab's version list, against real PostgreSQL.
// Rows are the golden snapshots (real v1, v2 and v3 shapes), because the read
// must verify every row it hands back: a snapshot that no longer verifies is
// left out, never shown as a version that could not be made live again.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { portalPublicationSnapshots } from '#/shared/db/schema/portal-publication.schema'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  GOLDEN_SCOPE,
  GOLDEN_V1_ROW,
  GOLDEN_V2_BG_PRIMARY_ROW,
} from '../../application/__fixtures__/publication-snapshots.golden'
import { GOLDEN_V3_BG_PRIMARY_ROW } from '../../application/__fixtures__/publication-snapshot-v3.golden'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createPortalHistoryRepository } from './portal-history.repository'

const ORG = organizationId(GOLDEN_SCOPE.organizationId)
const OTHER_ORG = organizationId('org-history-versions-2')
const PROPERTY = propertyId(GOLDEN_SCOPE.propertyId)
const PORTAL = portalId(GOLDEN_SCOPE.portalId)

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['portal_publication_snapshots', 'portals', 'properties'],
})

async function seedPortal() {
  const at = new Date('2026-08-01T00:00:00Z')
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Golden Property', 'golden-property', 'UTC', $3, $3)`,
    [PROPERTY, ORG, at],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Golden Portal', 'golden-portal', 'published', $4, $4)`,
    [PORTAL, ORG, PROPERTY, at],
  )
}

const insert = (row: Readonly<Record<string, unknown>>) =>
  getDb()
    .insert(portalPublicationSnapshots)
    .values(row as typeof portalPublicationSnapshots.$inferInsert)

beforeEach(seedPortal)

describe.sequential(
  'Portal history repository, published versions (real PostgreSQL)',
  () => {
    it('lists the versions newest first, whatever schema version each was written in', async () => {
      await insert(GOLDEN_V1_ROW)
      await insert(GOLDEN_V2_BG_PRIMARY_ROW)
      await insert(GOLDEN_V3_BG_PRIMARY_ROW)
      const repo = createPortalHistoryRepository(getDb())

      const rows = await repo.listPublishedVersions(ORG, PROPERTY, PORTAL, 10)

      expect(rows.map((row) => [row.version, row.configuration.schemaVersion])).toEqual([
        [3, 3],
        [2, 2],
        [1, 1],
      ])
      expect(rows[0]).toMatchObject({
        publishedBy: GOLDEN_V3_BG_PRIMARY_ROW.createdBy,
        publishedAt: GOLDEN_V3_BG_PRIMARY_ROW.createdAt,
      })
    })

    it('stops at the limit, keeping the newest', async () => {
      await insert(GOLDEN_V1_ROW)
      await insert(GOLDEN_V2_BG_PRIMARY_ROW)
      await insert(GOLDEN_V3_BG_PRIMARY_ROW)
      const repo = createPortalHistoryRepository(getDb())

      const rows = await repo.listPublishedVersions(ORG, PROPERTY, PORTAL, 2)

      expect(rows.map((row) => row.version)).toEqual([3, 2])
    })

    it('leaves out a snapshot whose digest no longer matches', async () => {
      await insert(GOLDEN_V1_ROW)
      await insert({
        ...GOLDEN_V2_BG_PRIMARY_ROW,
        configurationDigest: GOLDEN_V2_BG_PRIMARY_ROW.configurationDigest.replace(
          /^./u,
          (first) => (first === '0' ? '1' : '0'),
        ),
      })
      const repo = createPortalHistoryRepository(getDb())

      const rows = await repo.listPublishedVersions(ORG, PROPERTY, PORTAL, 10)

      expect(rows.map((row) => row.version)).toEqual([1])
    })

    it('says in the log which snapshot stopped verifying, since an immutable one should not', async () => {
      await insert(GOLDEN_V1_ROW)
      await insert({
        ...GOLDEN_V2_BG_PRIMARY_ROW,
        configurationDigest: GOLDEN_V2_BG_PRIMARY_ROW.configurationDigest.replace(
          /^./u,
          (first) => (first === '0' ? '1' : '0'),
        ),
      })
      const warn = vi.fn()
      const logger = { warn, child: () => logger } as unknown as LoggerPort
      const repo = createPortalHistoryRepository(getDb(), logger)

      await repo.listPublishedVersions(ORG, PROPERTY, PORTAL, 10)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          portalId: PORTAL,
          snapshotId: GOLDEN_V2_BG_PRIMARY_ROW.id,
          version: GOLDEN_V2_BG_PRIMARY_ROW.version,
        }),
        expect.stringContaining('no longer verifies'),
      )
    })

    it('lists nothing for another Organization or another Property', async () => {
      await insert(GOLDEN_V1_ROW)
      const repo = createPortalHistoryRepository(getDb())

      await expect(
        repo.listPublishedVersions(OTHER_ORG, PROPERTY, PORTAL, 10),
      ).resolves.toEqual([])
      await expect(
        repo.listPublishedVersions(
          ORG,
          propertyId('f0000000-0000-4000-8000-000000000009'),
          PORTAL,
          10,
        ),
      ).resolves.toEqual([])
    })
  },
)
