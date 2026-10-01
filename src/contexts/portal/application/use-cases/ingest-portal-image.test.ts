// Portal context — server-side image ingest: authorise, check, decode, re-encode, store.

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ingestPortalImage, type IngestPortalImageInput } from './ingest-portal-image'
import { createSharpImageProcessor } from '../../infrastructure/adapters/sharp-image-processor.adapter'
import { isPortalError, type PortalError } from '../../domain/errors'
import {
  MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY,
  type PortalMediaAsset,
} from '../../domain/portal-media-asset'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ImageProcessorPort } from '../ports/image-processor.port'
import { organizationId, propertyId, type PropertyId } from '#/shared/domain/ids'
import { createHash } from 'node:crypto'

const NOW = new Date('2026-10-01T12:00:00Z')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')

/** A logger that keeps what it is told, so a test can say what was reported. */
const recordingLogger = () => {
  const errors: string[] = []
  const record = (first: unknown, second?: unknown) =>
    errors.push(typeof first === 'string' ? first : String(second ?? ''))
  const logger: LoggerPort = {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: record,
    child: () => logger,
  }
  return { logger, errors }
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
  properties?: ReadonlyArray<PropertyId>
  processor?: ImageProcessorPort
}>

const setup = (overrides: Overrides = {}) => {
  const portalRepo = createInMemoryPortalRepo()
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objects = createInMemoryObjectStore()
  const { logger, errors } = recordingLogger()
  let next = 0
  const known = overrides.properties ?? [PROPERTY, OTHER_PROPERTY]
  const realProcessor = createSharpImageProcessor()
  const calls = { inspect: 0, reencode: 0 }
  const processor: ImageProcessorPort = overrides.processor ?? {
    inspect: async (bytes) => {
      calls.inspect += 1
      return realProcessor.inspect(bytes)
    },
    reencode: async (bytes, plan) => {
      calls.reencode += 1
      return realProcessor.reencode(bytes, plan)
    },
  }
  const useCase = ingestPortalImage({
    portalRepo,
    staffPublicApi: staffApi(overrides.accessible ?? null),
    propertyApi: {
      propertyExists: async (orgId, id) =>
        orgId === organizationId('org-00000000-0000-0000-0000-000000000001') &&
        known.includes(id),
    },
    mediaRepo,
    objectStore: objects,
    imageProcessor: processor,
    sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    idGen: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`,
    clock: () => NOW,
    logger,
  })
  const portal = buildTestPortal()
  portalRepo.seed([portal])
  return { useCase, portalRepo, mediaRepo, objects, errors, calls, portal }
}

const admin = () => buildTestAuthContext({ role: 'AccountAdmin' })
const manager = () => buildTestAuthContext({ role: 'PropertyManager' })
const member = () => buildTestAuthContext({ role: 'Member' })

const input = async (
  overrides: Partial<IngestPortalImageInput> = {},
): Promise<IngestPortalImageInput> => ({
  propertyId: PROPERTY,
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

describe('ingestPortalImage', () => {
  it('stores a re-encoded WebP and a row that describes it', async () => {
    const { useCase, mediaRepo, objects } = setup()
    const upload = await input()

    const result = await useCase(upload, admin())

    const [asset] = mediaRepo.all() as readonly PortalMediaAsset[]
    expect(mediaRepo.all()).toHaveLength(1)
    expect(result).toEqual({
      assetId: asset?.id,
      purpose: 'hero',
      width: 2400,
      height: 1500,
      byteSize: asset?.byteSize,
      contentType: 'image/webp',
    })
    expect(asset).toMatchObject({
      organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
      propertyId: PROPERTY,
      purpose: 'hero',
      status: 'active',
      contentType: 'image/webp',
      width: 2400,
      height: 1500,
      sourceFormat: 'jpeg',
      sourceBytes: upload.bytes.length,
      rightsConfirmedAt: NOW,
      createdAt: NOW,
      takenDownAt: null,
    })
    expect(asset?.objectKey).toBe(portalMediaObjectKey(asset?.id ?? ''))

    const stored = objects.objects().get(asset?.objectKey ?? '')
    expect(stored?.contentType).toBe('image/webp')
    expect(stored?.body.subarray(8, 12).toString('latin1')).toBe('WEBP')
    expect(stored?.body.equals(Buffer.from(upload.bytes))).toBe(false)
    expect(asset?.byteSize).toBe(stored?.body.length)
    expect(asset?.contentSha256).toBe(
      createHash('sha256')
        .update(stored?.body ?? '')
        .digest('hex'),
    )
  })

  it('never hands the caller the object key', async () => {
    const { useCase } = setup()
    const result = await useCase(await input(), admin())
    expect(JSON.stringify(result)).not.toContain('portal-media/')
  })

  describe('who may upload', () => {
    it.each(['hero', 'logo'] as const)(
      'lets only an Account Admin upload a Property-wide %s',
      async (purpose) => {
        const bytes = await photo(1600, 900)
        const { useCase, mediaRepo, calls } = setup()
        const error = await failure(useCase(await input({ purpose, bytes }), manager()))
        expect(error.code).toBe('forbidden')
        expect(mediaRepo.all()).toHaveLength(0)
        expect(calls.inspect).toBe(0)
        await expect(
          useCase(await input({ purpose, bytes }), admin()),
        ).resolves.toMatchObject({ purpose })
      },
    )

    it('lets a Property Manager upload the picture on a link tile of a Portal they manage', async () => {
      const { useCase, portal } = setup()
      await expect(
        useCase(
          await input({
            purpose: 'link_image',
            portalId: portal.id,
            bytes: await photo(1200, 800),
          }),
          manager(),
        ),
      ).resolves.toMatchObject({ purpose: 'link_image', width: 1200 })
    })

    it('refuses a Member everything', async () => {
      const { useCase, mediaRepo } = setup()
      for (const purpose of ['hero', 'logo', 'link_image'] as const) {
        const error = await failure(useCase(await input({ purpose }), member()))
        expect(error.code).toBe('forbidden')
      }
      expect(mediaRepo.all()).toHaveLength(0)
    })

    it('refuses a Property Manager who is not assigned to the Property', async () => {
      const { useCase, portal, calls } = setup({ accessible: [OTHER_PROPERTY] })
      const error = await failure(
        useCase(await input({ purpose: 'link_image', portalId: portal.id }), manager()),
      )
      expect(error.code).toBe('forbidden')
      expect(calls.inspect).toBe(0)
    })

    it('does not find a Property of another Organization', async () => {
      const { useCase } = setup()
      const outsider = buildTestAuthContext({
        role: 'AccountAdmin',
        organizationId: organizationId('org-99999999-0000-0000-0000-000000000009'),
      })
      const error = await failure(useCase(await input(), outsider))
      expect(error.code).toBe('property_not_found')
    })

    it('does not find a Property that does not exist', async () => {
      const { useCase } = setup({ properties: [] })
      expect((await failure(useCase(await input(), admin()))).code).toBe(
        'property_not_found',
      )
    })
  })

  describe('a link tile’s image', () => {
    it('needs a Portal', async () => {
      const { useCase } = setup()
      const error = await failure(
        useCase(await input({ purpose: 'link_image' }), manager()),
      )
      expect(error.code).toBe('portal_not_found')
    })

    it('needs a Portal of the same Property', async () => {
      const { useCase, portalRepo } = setup()
      const elsewhere = buildTestPortal({
        id: 'd0000000-0000-0000-0000-000000000002',
        propertyId: OTHER_PROPERTY,
        slug: 'elsewhere',
      })
      portalRepo.seed([elsewhere])
      const error = await failure(
        useCase(await input({ purpose: 'link_image', portalId: elsewhere.id }), admin()),
      )
      expect(error.code).toBe('portal_not_found')
    })
  })

  describe('what is refused before anything is decoded or stored', () => {
    const refusedBeforeDecode = async (
      overrides: Partial<IngestPortalImageInput>,
      reason: string,
    ) => {
      const { useCase, mediaRepo, objects, calls } = setup()
      const error = await failure(useCase(await input(overrides), admin()))
      expect(error).toMatchObject({ code: 'image_rejected', context: { reason } })
      expect(calls.inspect).toBe(0)
      expect(mediaRepo.all()).toHaveLength(0)
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
      const { useCase, mediaRepo, objects } = setup()
      const error = await failure(
        useCase(await input({ bytes: await photo(640, 360) }), admin()),
      )
      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'too_small' },
      })
      expect(mediaRepo.all()).toHaveLength(0)
      expect(objects.objects().size).toBe(0)
    })

    it('refuses bytes the decoder cannot read, storing nothing', async () => {
      const { useCase, mediaRepo, objects } = setup()
      const truncated = (await photo()).subarray(0, 600)
      const error = await failure(useCase(await input({ bytes: truncated }), admin()))
      expect(error.code).toBe('image_rejected')
      expect(mediaRepo.all()).toHaveLength(0)
      expect(objects.objects().size).toBe(0)
    })

    it('refuses output over the purpose budget, storing nothing', async () => {
      const real = createSharpImageProcessor()
      const { useCase, mediaRepo, objects } = setup({
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
      const error = await failure(useCase(await input(), admin()))
      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'output_too_large' },
      })
      expect(mediaRepo.all()).toHaveLength(0)
      expect(objects.objects().size).toBe(0)
    })
  })

  describe('limits per Property', () => {
    it('refuses another image once the Property holds its share', async () => {
      const { useCase, mediaRepo, calls } = setup()
      mediaRepo.seed(
        Array.from({ length: MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY }, () =>
          buildTestPortalMediaAsset({ propertyId: PROPERTY }),
        ),
      )
      const error = await failure(useCase(await input(), admin()))
      expect(error).toMatchObject({
        code: 'image_rejected',
        context: { reason: 'asset_limit_reached' },
      })
      expect(calls.inspect).toBe(0)
    })

    it('counts per Property: another Property’s images do not use the allowance', async () => {
      const { useCase, mediaRepo } = setup()
      mediaRepo.seed(
        Array.from({ length: MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY }, () =>
          buildTestPortalMediaAsset({ propertyId: OTHER_PROPERTY }),
        ),
      )
      await expect(useCase(await input(), admin())).resolves.toMatchObject({
        purpose: 'hero',
      })
    })
  })

  describe('when storing goes wrong', () => {
    it('reports a failed object write and leaves no row', async () => {
      const { useCase, mediaRepo, objects } = setup()
      objects.failNextPut(new Error('bucket unavailable'))
      const error = await failure(useCase(await input(), admin()))
      expect(error.code).toBe('upload_failed')
      expect(mediaRepo.all()).toHaveLength(0)
    })

    it('removes the object when its row cannot be written', async () => {
      const { useCase, mediaRepo, objects } = setup()
      mediaRepo.failNextInsert(new Error('db down'))
      await expect(useCase(await input(), admin())).rejects.toThrow('db down')
      expect(objects.objects().size).toBe(0)
    })

    it('still reports the row failure when the clean-up fails too, and says so', async () => {
      const { useCase, mediaRepo, objects, errors } = setup()
      mediaRepo.failNextInsert(new Error('db down'))
      objects.failNextDelete(new Error('bucket down'))
      await expect(useCase(await input(), admin())).rejects.toThrow('db down')
      expect(errors.join(' ')).toContain('orphan')
      // The object stays for the garbage collector; no content is logged.
      expect(objects.objects().size).toBe(1)
    })
  })
})
