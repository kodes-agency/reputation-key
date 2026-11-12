// Portal context — the image ingest against real Postgres and the real decoder,
// with two Organizations. The use case authorises, checks, decodes, re-encodes
// and stores; the database constraints are the second opinion on the row it
// builds (derived object key, hash shape, dimensions, Property tenancy).

import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { getDb } from '#/shared/db'
import { organizationId, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  ingestPortalImage,
  type IngestPortalImageInput,
} from '../application/use-cases/ingest-portal-image'
import type { ImageProcessorPort } from '../application/ports/image-processor.port'
import { isPortalError, type PortalError } from '../domain/errors'
import { MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY } from '../domain/portal-media-asset'
import { createSharpImageProcessor } from './adapters/sharp-image-processor.adapter'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import { createPortalRepository } from './repositories/portal.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedMediaAsset,
  seedMediaPortal,
  seedMediaProperty,
} from './testing/portal-media-experience-seed'

const ORG = organizationId('org-ingest-0000000000000000001')
const OTHER_ORG = organizationId('org-ingest-0000000000000000002')
const NOW = new Date('2026-10-01T12:00:00Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: MEDIA_EXPERIENCE_TABLES,
})

/** A logger that keeps what it is told, so a test can say what was reported. */
const recordingLogger = () => {
  const errors: string[] = []
  const contexts: unknown[] = []
  const record = (first: unknown, second?: unknown) => {
    errors.push(typeof first === 'string' ? first : String(second ?? ''))
    if (typeof first !== 'string') contexts.push(first)
  }
  const logger: LoggerPort = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: record,
    child: () => logger,
  }
  return { logger, errors, contexts }
}

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const photo = (width = 3200, height = 2000) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer()

type Overrides = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  processor?: ImageProcessorPort
  sha256Hex?: (bytes: Uint8Array) => string
}>

const setup = (overrides: Overrides = {}) => {
  const objects = createInMemoryObjectStore()
  const mediaRepo = createPortalMediaAssetRepository(getDb())
  const propertyRepo = createPropertyRepository(getDb())
  const { logger, errors, contexts } = recordingLogger()
  const realProcessor = createSharpImageProcessor()
  const calls = { inspect: 0 }
  const processor: ImageProcessorPort = overrides.processor ?? {
    inspect: async (bytes) => {
      calls.inspect += 1
      return realProcessor.inspect(bytes)
    },
    reencode: realProcessor.reencode,
  }
  const useCase = ingestPortalImage({
    portalRepo: createPortalRepository(getDb()),
    staffPublicApi: staffApi(overrides.accessible ?? null),
    propertyApi: {
      propertyExists: async (org, id) => (await propertyRepo.findById(org, id)) !== null,
    },
    mediaRepo,
    objectStore: objects,
    imageProcessor: processor,
    sha256Hex:
      overrides.sha256Hex ??
      ((bytes) => createHash('sha256').update(bytes).digest('hex')),
    idGen: randomUUID,
    clock: () => NOW,
    logger,
  })
  return { useCase, objects, mediaRepo, errors, contexts, calls }
}

async function scene() {
  const property = await seedMediaProperty(getPool(), ORG)
  const otherProperty = await seedMediaProperty(getPool(), ORG)
  const portal = await seedMediaPortal(getPool(), ORG, property, { state: 'published' })
  return { property, otherProperty, portal }
}

const admin = (org: OrganizationId = ORG) =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: org })
const manager = () =>
  buildTestAuthContext({ role: 'PropertyManager', organizationId: ORG })
const member = () => buildTestAuthContext({ role: 'Member', organizationId: ORG })

const inputFor = async (
  property: PropertyId,
  overrides: Partial<IngestPortalImageInput> = {},
): Promise<IngestPortalImageInput> => ({
  propertyId: property,
  purpose: 'hero',
  declaredContentType: 'image/jpeg',
  bytes: await photo(),
  rightsConfirmed: true,
  ...overrides,
})

const failure = async (promise: Promise<unknown>): Promise<PortalError> => {
  try {
    await promise
  } catch (error) {
    if (isPortalError(error)) return error
    throw error
  }
  throw new Error('expected the ingest to fail')
}

const rowCount = async (org: OrganizationId = ORG) =>
  (
    await getPool().query(
      'SELECT count(*)::int AS n FROM portal_media_assets WHERE organization_id = $1',
      [org],
    )
  ).rows[0].n as number

describe('ingestPortalImage (real PostgreSQL)', () => {
  it('stores a re-encoded WebP and a row that describes it', async () => {
    const { property } = await scene()
    const { useCase, objects, mediaRepo } = setup()
    const upload = await inputFor(property)

    const result = await useCase(upload, admin())

    const row = await getPool().query(
      `SELECT organization_id, property_id::text AS property_id, purpose, status,
              object_key, content_type, width, height, byte_size, content_sha256,
              source_format, source_bytes, rights_confirmed_at, created_at,
              taken_down_at
       FROM portal_media_assets WHERE id = $1`,
      [result.assetId],
    )
    expect(row.rows).toHaveLength(1)
    const stored = objects.objects().get(row.rows[0].object_key)
    expect(result).toEqual({
      assetId: result.assetId,
      purpose: 'hero',
      width: 2400,
      height: 1500,
      byteSize: stored?.body.length,
      contentType: 'image/webp',
    })
    expect(row.rows[0]).toMatchObject({
      organization_id: ORG,
      property_id: property,
      purpose: 'hero',
      status: 'active',
      object_key: portalMediaObjectKey(result.assetId),
      content_type: 'image/webp',
      width: 2400,
      height: 1500,
      byte_size: stored?.body.length,
      source_format: 'jpeg',
      source_bytes: upload.bytes.length,
      rights_confirmed_at: NOW,
      created_at: NOW,
      taken_down_at: null,
    })
    expect(stored?.contentType).toBe('image/webp')
    expect(stored?.body.subarray(8, 12).toString('latin1')).toBe('WEBP')
    expect(stored?.body.equals(Buffer.from(upload.bytes))).toBe(false)
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
  })

  it('stores a logo within its own size budget', async () => {
    const { property } = await scene()
    const { useCase } = setup()
    const logo = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer()

    const result = await useCase(
      await inputFor(property, {
        purpose: 'logo',
        declaredContentType: 'image/png',
        bytes: logo,
      }),
      admin(),
    )

    expect(result).toMatchObject({ purpose: 'logo' })
    const row = await getPool().query(
      'SELECT source_format FROM portal_media_assets WHERE id = $1',
      [result.assetId],
    )
    expect(row.rows[0].source_format).toBe('png')
  })

  it('never hands the caller the object key', async () => {
    const { property } = await scene()
    const { useCase } = setup()
    const result = await useCase(await inputFor(property), admin())
    expect(JSON.stringify(result)).not.toContain('portal-media/')
  })

  describe('who may upload', () => {
    it.each(['hero', 'logo'] as const)(
      'lets only an Account Admin upload a Property-wide %s',
      async (purpose) => {
        const { property } = await scene()
        const bytes = await photo(1600, 900)
        const { useCase, calls } = setup()

        const error = await failure(
          useCase(await inputFor(property, { purpose, bytes }), manager()),
        )

        expect(error.code).toBe('forbidden')
        expect(await rowCount()).toBe(0)
        expect(calls.inspect).toBe(0)
        await expect(
          useCase(await inputFor(property, { purpose, bytes }), admin()),
        ).resolves.toMatchObject({ purpose })
      },
    )

    it('lets a Property Manager upload the picture on a link tile of a Portal they manage', async () => {
      const { property, portal } = await scene()
      const { useCase } = setup()

      await expect(
        useCase(
          await inputFor(property, {
            purpose: 'link_image',
            portalId: portal,
            bytes: await photo(1200, 800),
          }),
          manager(),
        ),
      ).resolves.toMatchObject({ purpose: 'link_image', width: 1200 })
    })

    it('refuses a Member everything', async () => {
      const { property } = await scene()
      const { useCase } = setup()

      for (const purpose of ['hero', 'logo', 'link_image'] as const) {
        const error = await failure(
          useCase(await inputFor(property, { purpose }), member()),
        )
        expect(error.code).toBe('forbidden')
      }
      expect(await rowCount()).toBe(0)
    })

    it('refuses a Property Manager who is not assigned to the Property', async () => {
      const { property, otherProperty, portal } = await scene()
      const { useCase, calls } = setup({ accessible: [otherProperty] })

      const error = await failure(
        useCase(
          await inputFor(property, { purpose: 'link_image', portalId: portal }),
          manager(),
        ),
      )

      expect(error.code).toBe('forbidden')
      expect(calls.inspect).toBe(0)
    })

    it('does not find a Property of another Organization', async () => {
      const { property } = await scene()
      const { useCase } = setup()

      const error = await failure(useCase(await inputFor(property), admin(OTHER_ORG)))

      expect(error.code).toBe('property_not_found')
      expect(await rowCount()).toBe(0)
      expect(await rowCount(OTHER_ORG)).toBe(0)
    })

    it('does not find a Property that does not exist', async () => {
      const { useCase } = setup()
      const error = await failure(useCase(await inputFor(randomUUID() as never), admin()))
      expect(error.code).toBe('property_not_found')
    })
  })

  describe('a link tile’s image', () => {
    it('needs a Portal', async () => {
      const { property } = await scene()
      const { useCase } = setup()

      const error = await failure(
        useCase(await inputFor(property, { purpose: 'link_image' }), manager()),
      )

      expect(error.code).toBe('portal_not_found')
    })

    it('needs a Portal of the same Property', async () => {
      const { property, otherProperty } = await scene()
      const elsewhere = await seedMediaPortal(getPool(), ORG, otherProperty)
      const { useCase } = setup()

      const error = await failure(
        useCase(
          await inputFor(property, { purpose: 'link_image', portalId: elsewhere }),
          admin(),
        ),
      )

      expect(error.code).toBe('portal_not_found')
    })

    it('does not find a Portal of another Organization', async () => {
      const { property } = await scene()
      const tenantB = await seedMediaProperty(getPool(), OTHER_ORG)
      const foreign = await seedMediaPortal(getPool(), OTHER_ORG, tenantB)
      const { useCase } = setup()

      const error = await failure(
        useCase(
          await inputFor(property, { purpose: 'link_image', portalId: foreign }),
          admin(),
        ),
      )

      expect(error.code).toBe('portal_not_found')
      expect(await rowCount()).toBe(0)
    })
  })

  describe('what is refused before anything is decoded or stored', () => {
    const refusedBeforeDecode = async (
      overrides: Partial<IngestPortalImageInput>,
      reason: string,
    ) => {
      const { property } = await scene()
      const { useCase, objects, calls } = setup()
      const error = await failure(useCase(await inputFor(property, overrides), admin()))
      expect(error).toMatchObject({ code: 'image_rejected', context: { reason } })
      expect(calls.inspect).toBe(0)
      expect(await rowCount()).toBe(0)
      expect(objects.objects().size).toBe(0)
    }

    it('a missing rights confirmation', () =>
      refusedBeforeDecode({ rightsConfirmed: false }, 'rights_not_confirmed'))

    it('an SVG', () =>
      refusedBeforeDecode(
        {
          declaredContentType: 'image/svg+xml',
          bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
        },
        'unsupported_type',
      ))

    it('bytes that are not what the declared type says', async () => {
      await refusedBeforeDecode(
        { declaredContentType: 'image/png', bytes: await photo() },
        'type_mismatch',
      )
    })

    it('an empty body', () => refusedBeforeDecode({ bytes: new Uint8Array() }, 'empty'))

    it('a body past the size limit', () => {
      const bytes = new Uint8Array(10 * 1024 * 1024 + 1)
      bytes.set([0xff, 0xd8, 0xff])
      return refusedBeforeDecode({ bytes }, 'too_large')
    })
  })

  describe('what the decoder reveals', () => {
    it('refuses a picture too small for its purpose, storing nothing', async () => {
      const { property } = await scene()
      const { useCase, objects } = setup()

      const error = await failure(
        useCase(await inputFor(property, { bytes: await photo(640, 360) }), admin()),
      )

      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'too_small' },
      })
      expect(await rowCount()).toBe(0)
      expect(objects.objects().size).toBe(0)
    })

    it('refuses bytes the decoder cannot read, storing nothing', async () => {
      const { property } = await scene()
      const { useCase, objects } = setup()
      const truncated = (await photo()).subarray(0, 600)

      const error = await failure(
        useCase(await inputFor(property, { bytes: truncated }), admin()),
      )

      expect(error.code).toBe('image_rejected')
      expect(await rowCount()).toBe(0)
      expect(objects.objects().size).toBe(0)
    })

    it('refuses output over the purpose budget, storing nothing', async () => {
      const { property } = await scene()
      const real = createSharpImageProcessor()
      const { useCase, objects } = setup({
        processor: {
          inspect: real.inspect,
          reencode: async (bytes, plan) => {
            const encoded = await real.reencode(bytes, plan)
            const padded = new Uint8Array(4 * 1024 * 1024)
            padded.set(encoded.bytes)
            return { ...encoded, bytes: padded }
          },
        },
      })

      const error = await failure(useCase(await inputFor(property), admin()))

      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'output_too_large' },
      })
      expect(await rowCount()).toBe(0)
      expect(objects.objects().size).toBe(0)
    })
  })

  describe('limits per Property', () => {
    const fillWithAssets = async (property: PropertyId) => {
      const rows = Array.from({ length: MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY }, () =>
        seedMediaAsset(ORG, property),
      )
      await Promise.all(rows)
    }

    it('refuses another image once the Property holds its share', async () => {
      const { property } = await scene()
      await fillWithAssets(property)
      const { useCase, calls } = setup()

      const error = await failure(useCase(await inputFor(property), admin()))

      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'asset_limit_reached' },
      })
      expect(calls.inspect).toBe(0)
    })

    it('counts per Property: another Property’s images do not use the allowance', async () => {
      const { property, otherProperty } = await scene()
      await fillWithAssets(otherProperty)
      const { useCase } = setup()

      await expect(useCase(await inputFor(property), admin())).resolves.toMatchObject({
        purpose: 'hero',
      })
    })
  })

  describe('when storing goes wrong', () => {
    it('reports a failed object write and leaves no row', async () => {
      const { property } = await scene()
      const { useCase, objects } = setup()
      objects.failNextPut(new Error('bucket unavailable'))

      const error = await failure(useCase(await inputFor(property), admin()))

      expect(error.code).toBe('upload_failed')
      expect(await rowCount()).toBe(0)
    })

    it('logs the cause of a failed object write, so a misconfigured bucket leaves a trace', async () => {
      const { property } = await scene()
      const { useCase, objects, contexts } = setup()
      const cause = new Error('bucket unavailable')
      objects.failNextPut(cause)

      await failure(useCase(await inputFor(property), admin()))

      expect(contexts).toEqual([
        expect.objectContaining({
          err: cause,
          errorCode: 'portal_media_store_failed',
          assetId: expect.any(String),
        }),
      ])
    })

    it('takes the object back when the database refuses the row', async () => {
      const { property } = await scene()
      const { useCase, objects } = setup({ sha256Hex: () => 'not-a-hash' })

      await expect(useCase(await inputFor(property), admin())).rejects.toMatchObject({
        cause: { constraint: 'portal_media_assets_sha256_valid' },
      })

      expect(objects.objects().size).toBe(0)
      expect(await rowCount()).toBe(0)
    })

    it('still reports the row failure when the clean-up fails too, and says so', async () => {
      const { property } = await scene()
      const { useCase, objects, errors } = setup({ sha256Hex: () => 'not-a-hash' })
      objects.failNextDelete(new Error('bucket down'))

      await expect(useCase(await inputFor(property), admin())).rejects.toMatchObject({
        cause: { constraint: 'portal_media_assets_sha256_valid' },
      })

      expect(errors.join(' ')).toContain('orphan')
      // The object stays for the garbage collector; no content is logged.
      expect(objects.objects().size).toBe(1)
    })
  })
})
