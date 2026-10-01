// Portal context — the ingest against real Postgres and the real decoder.
// The use case builds the row; the database constraints are the second opinion
// on it (derived object key, hash shape, dimensions, Property tenancy).

import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { ingestPortalImage } from '../application/use-cases/ingest-portal-image'
import { createSharpImageProcessor } from './adapters/sharp-image-processor.adapter'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'

const ORG = organizationId('org-ingest-aaaaaaaaaa')
const OTHER_ORG = organizationId('org-ingest-bbbbbbbbbb')
const PROPERTY = propertyId('fa000000-0000-4000-8000-000000000001')

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await pool.query('DELETE FROM portal_media_assets WHERE organization_id = ANY($1)', [
    [ORG, OTHER_ORG],
  ])
  for (const id of [ORG, OTHER_ORG]) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, `Test Org ${slug}`, slug],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'ingest', 'ingest', 'UTC')
     ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
    [PROPERTY, ORG],
  )
})

const staffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = () => {
  const objects = createInMemoryObjectStore()
  const mediaRepo = createPortalMediaAssetRepository(getDb())
  const useCase = ingestPortalImage({
    portalRepo: createInMemoryPortalRepo(),
    staffPublicApi: staffApi,
    propertyApi: {
      propertyExists: async (orgId, id) => orgId === ORG && id === PROPERTY,
    },
    mediaRepo,
    objectStore: objects,
    imageProcessor: createSharpImageProcessor(),
    sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    idGen: randomUUID,
    clock: () => new Date('2026-10-01T12:00:00Z'),
    logger: { error: () => {} },
  })
  return { useCase, objects, mediaRepo }
}

const admin = buildTestAuthContext({ role: 'AccountAdmin', organizationId: ORG })

describe('ingestPortalImage (integration)', () => {
  it.each([
    ['hero', 3600, 2400],
    ['logo', 1200, 400],
  ] as const)(
    'stores a %s that the database accepts and reads back',
    async (purpose, w, h) => {
      const { useCase, objects, mediaRepo } = setup()
      const upload = await sharp({
        create: { width: w, height: h, channels: 3, background: '#336699' },
      })
        .png()
        .toBuffer()

      const result = await useCase(
        {
          propertyId: PROPERTY,
          purpose,
          declaredContentType: 'image/png',
          bytes: upload,
          rightsConfirmed: true,
        },
        admin,
      )

      const row = await pool.query(
        'SELECT purpose, status, object_key, width, height, byte_size, content_sha256, source_format, source_bytes FROM portal_media_assets WHERE id = $1',
        [result.assetId],
      )
      expect(row.rows).toHaveLength(1)
      const stored = objects.objects().get(row.rows[0].object_key)
      expect(stored).toBeDefined()
      expect(row.rows[0]).toMatchObject({
        purpose,
        status: 'active',
        object_key: `portal-media/${result.assetId}.webp`,
        width: result.width,
        height: result.height,
        byte_size: stored?.body.length,
        source_format: 'png',
        source_bytes: upload.length,
      })
      expect(row.rows[0].content_sha256).toBe(
        createHash('sha256')
          .update(stored?.body ?? '')
          .digest('hex'),
      )
      expect(await mediaRepo.findById(ORG, result.assetId as never)).toMatchObject({
        id: result.assetId,
        contentType: 'image/webp',
      })
      expect(await mediaRepo.findById(OTHER_ORG, result.assetId as never)).toBeNull()
    },
  )

  it('leaves no row behind when the image is refused', async () => {
    const { useCase, objects } = setup()
    await expect(
      useCase(
        {
          propertyId: PROPERTY,
          purpose: 'hero',
          declaredContentType: 'image/jpeg',
          bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          rightsConfirmed: true,
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'image_rejected' })
    const rows = await pool.query(
      'SELECT count(*)::int AS n FROM portal_media_assets WHERE organization_id = $1',
      [ORG],
    )
    expect(rows.rows[0].n).toBe(0)
    expect(objects.objects().size).toBe(0)
  })

  it('takes the object back when the database refuses the row', async () => {
    const { objects } = setup()
    const failing = ingestPortalImage({
      portalRepo: createInMemoryPortalRepo(),
      staffPublicApi: staffApi,
      propertyApi: { propertyExists: async () => true },
      mediaRepo: createPortalMediaAssetRepository(getDb()),
      objectStore: objects,
      imageProcessor: createSharpImageProcessor(),
      sha256Hex: () => 'not-a-hash',
      idGen: randomUUID,
      clock: () => new Date(),
      logger: { error: () => {} },
    })
    const upload = await sharp({
      create: { width: 3200, height: 2000, channels: 3, background: '#999999' },
    })
      .jpeg()
      .toBuffer()
    await expect(
      failing(
        {
          propertyId: PROPERTY,
          purpose: 'hero',
          declaredContentType: 'image/jpeg',
          bytes: upload,
          rightsConfirmed: true,
        },
        admin,
      ),
    ).rejects.toMatchObject({
      cause: { constraint: 'portal_media_assets_sha256_valid' },
    })
    expect(objects.objects().size).toBe(0)
  })
})
