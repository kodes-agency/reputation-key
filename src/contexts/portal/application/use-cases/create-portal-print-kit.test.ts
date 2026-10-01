// Portal context — the print kit PDF (round 4, slice 45): the one use case that
// puts the code's address into a file, so it authorises and validates before it
// discloses, and it discloses through the audited reveal.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { portalMediaAssetId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
  SOURCE_LOGO_ASSET_ID,
} from '../../domain/__fixtures__/publication-source'
import { portalError } from '../../domain/errors'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import type {
  PortalPrintKitRenderer,
  PrintKitRenderInput,
} from '../ports/portal-print-kit-renderer.port'
import { createPortalPrintKit, printKitDownloadOf } from './create-portal-print-kit'
import type { RevealPortalAddress } from './reveal-portal-address'

const QR_ADDRESS =
  'https://app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?accessArtifact=11111111-1111-4111-8111-111111111111'
const PDF = new Uint8Array([37, 80, 68, 70])
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const HERO_BYTES = Buffer.from('hero image bytes')
const LOGO_BYTES = Buffer.from('logo image bytes')

const staffApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

type Options = Readonly<{
  source?: PortalPublicationSource
  accessible?: readonly PropertyId[] | null
  reveal?: RevealPortalAddress
  heroStatus?: 'active' | 'taken_down'
  storeHero?: boolean
  heroHash?: string
}>

async function setup(options: Options = {}) {
  const portal = buildTestPortal({ name: 'Harbor lobby' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objectStore = createInMemoryObjectStore()
  const hero = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_HERO_ASSET_ID),
    purpose: 'hero',
    status: options.heroStatus ?? 'active',
    byteSize: HERO_BYTES.length,
    contentSha256: options.heroHash ?? sha256Hex(HERO_BYTES),
  })
  const logo = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_LOGO_ASSET_ID),
    purpose: 'logo',
    byteSize: LOGO_BYTES.length,
    contentSha256: sha256Hex(LOGO_BYTES),
  })
  mediaRepo.seed([hero, logo])
  if (options.storeHero !== false) {
    await objectStore.putObject(hero.objectKey, HERO_BYTES, 'image/webp')
  }
  await objectStore.putObject(logo.objectKey, LOGO_BYTES, 'image/webp')
  const reveal = vi.fn<RevealPortalAddress>(
    options.reveal ??
      (async () => ({
        publicUrl: QR_ADDRESS,
        publicUrls: { qr: QR_ADDRESS, nfc: `${QR_ADDRESS}-nfc` },
        version: 1,
        issuedAt: new Date('2026-10-01T10:00:00Z'),
      })),
  )
  const rendered: PrintKitRenderInput[] = []
  const renderer: PortalPrintKitRenderer = {
    render: vi.fn(async (input) => {
      rendered.push(input)
      return PDF
    }),
  }
  const make = createPortalPrintKit({
    portalRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    publicationRepo: {
      loadWorkingCopy: async () => options.source ?? publicationSource(),
    },
    mediaRepo,
    objectStore,
    sha256Hex,
    revealAddress: reveal,
    renderer,
  })
  return { portal, make, reveal, renderer, rendered }
}

const choice = {
  piece: 'table_tent',
  languages: ['en', 'bg'],
  callToAction: 'rate',
} as const

describe('createPortalPrintKit', () => {
  it('renders the piece the manager chose, for the address of the live code', async () => {
    const { portal, make, rendered } = await setup()

    const result = await make({ portalId: portal.id, ...choice }, buildTestAuthContext())

    expect(result).toEqual({
      fileName: 'harbor-lobby-table-tent.pdf',
      contentType: 'application/pdf',
      pdf: PDF,
    })
    const [input] = rendered
    expect(input?.piece).toBe('table_tent')
    expect(input?.qrAddress).toBe(QR_ADDRESS)
    expect(input?.shortAddress).toBe(
      'app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    )
    expect(input?.faces.map((face) => face.side)).toEqual(['front', 'back'])
    expect(input?.faces[0]?.blocks.map((block) => block.headline)).toEqual([
      'Rate your visit',
      'Оценете посещението си',
    ])
    expect(input?.wordmark).toBe('HARBOR')
    expect(input?.title).toBe('Harbor lobby table tent')
  })

  it('reads the address through the audited reveal, as a download', async () => {
    const { portal, make, reveal } = await setup()
    const ctx = buildTestAuthContext()
    await make({ portalId: portal.id, ...choice }, ctx)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith({ portalId: portal.id, purpose: 'download' }, ctx)
  })

  it('prints the photo and the logo it reads from the media store', async () => {
    const { portal, make, rendered } = await setup()
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    const [input] = rendered
    expect(Buffer.from(input?.photo?.bytes ?? []).toString()).toBe('hero image bytes')
    expect(input?.photo).toMatchObject({ focalX: 0.4, focalY: 0.6 })
    expect(Buffer.from(input?.logo ?? []).toString()).toBe('logo image bytes')
  })

  it('prints no photo and no logo when the property has none', async () => {
    const base = publicationSource().look
    if (base === null) throw new Error('fixture has a look')
    const { portal, make, rendered } = await setup({
      source: publicationSource({ look: { ...base, hero: null, logo: null } }),
    })
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    expect(rendered[0]?.photo).toBeNull()
    expect(rendered[0]?.logo).toBeNull()
  })

  it('prints without a photo that has been taken down since', async () => {
    const { portal, make, rendered } = await setup({ heroStatus: 'taken_down' })
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    expect(rendered[0]?.photo).toBeNull()
  })

  it('refuses a photo whose stored bytes are not what was stored', async () => {
    const { portal, make, reveal } = await setup({ heroHash: 'f'.repeat(64) })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'media_not_found' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses a photo whose object is missing', async () => {
    const { portal, make, reveal } = await setup({ storeHero: false })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'media_not_found' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses languages the portal does not offer, before it discloses anything', async () => {
    const { portal, make, reveal, renderer } = await setup()
    await expect(
      make(
        { portalId: portal.id, ...choice, languages: ['en', 'fr'] },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('refuses a caller who may not update the Portal, before it discloses anything', async () => {
    const { portal, make, reveal } = await setup()
    await expect(
      make(
        { portalId: portal.id, ...choice },
        buildTestAuthContext({ effectivePermissions: new Set(['portal.read']) }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, make, reveal } = await setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('makes nothing when the address cannot be fetched again', async () => {
    const { portal, make, renderer } = await setup({
      reveal: async () => {
        throw portalError('address_unavailable', 'This code cannot be downloaded again.')
      },
    })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(renderer.render).not.toHaveBeenCalled()
  })
})

describe('printKitDownloadOf', () => {
  it('sends the file as base64 under its name and type', () => {
    expect(
      printKitDownloadOf({
        fileName: 'harbor-table-tent.pdf',
        contentType: 'application/pdf',
        pdf: new Uint8Array([37, 80, 68, 70]),
      }),
    ).toEqual({
      fileName: 'harbor-table-tent.pdf',
      contentType: 'application/pdf',
      pdfBase64: Buffer.from('%PDF').toString('base64'),
    })
  })
})
