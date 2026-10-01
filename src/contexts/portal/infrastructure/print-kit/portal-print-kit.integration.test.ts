// The print kit over real PostgreSQL (round 4, slice 45): the Property's look
// and the Portal's titles are read from the working-copy tables, the photo and
// the logo are read from the media rows and the object store, and a real PDF is
// drawn from them. Only the address is stubbed (it comes from the sealed copy,
// which has its own tests).

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalPrintKit } from '../../application/use-cases/create-portal-print-kit'
import { getPortalPrintKit } from '../../application/use-cases/get-portal-print-kit'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalRepository } from '../repositories/portal.repository'
import { seedPortalWorkingCopy } from '../testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../testing/portal-working-copy-scenarios'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'

const ADDRESS =
  'https://app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?accessArtifact=11111111-1111-4111-8111-111111111111'
const LOGO_ASSET = 'c5000000-0000-4000-8000-000000000002'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
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

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Stores a real picture under an asset the seed made, and makes its row say so. */
async function storePicture(
  store: ReturnType<typeof createInMemoryObjectStore>,
  assetId: string,
  size: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const body = await sharp({
    create: { ...size, channels: 3, background: '#557766' },
  })
    .webp()
    .toBuffer()
  await store.putObject(`portal-media/${assetId}.webp`, body, 'image/webp')
  await getPool().query(
    `UPDATE portal_media_assets SET byte_size = $2, content_sha256 = $3 WHERE id = $1::uuid`,
    [assetId, body.length, sha256Hex(body)],
  )
}

async function harness() {
  await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
  const objectStore = createInMemoryObjectStore()
  await storePicture(objectStore, SCENARIO_HERO_ASSET, { width: 1600, height: 1000 })
  await storePicture(objectStore, LOGO_ASSET, { width: 480, height: 120 })
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const publicationRepo = createPortalPublicationRepository(db)
  const common = { portalRepo, staffPublicApi, publicationRepo }
  return {
    read: getPortalPrintKit(common),
    make: createPortalPrintKit({
      ...common,
      mediaRepo: createPortalMediaAssetRepository(db),
      objectStore,
      sha256Hex,
      revealAddress: async () => ({
        publicUrl: ADDRESS,
        publicUrls: { qr: ADDRESS, nfc: ADDRESS },
        version: 1,
        issuedAt: new Date('2026-10-01T10:00:00Z'),
      }),
      renderer: createPdfKitPrintKitRenderer({
        now: () => new Date('2026-10-01T10:00:00Z'),
        compress: false,
      }),
    }),
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
  }
}

describe.sequential('Portal print kit (real PostgreSQL)', () => {
  it('reads the Portal titles, languages and look from the working-copy tables', async () => {
    const { read, ctx } = await harness()

    const view = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)

    expect(view.primaryLocale).toBe('bg')
    expect(view.locales).toEqual(['bg', 'en'])
    expect(view.titles).toEqual({ bg: 'Хотел Рила', en: 'Hotel Rila Lobby' })
    expect(view.look.wordmark).toBe('RILA')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${SCENARIO_HERO_ASSET}`)
    expect(view.look.heroFocal).toEqual({ x: 0.3, y: 0.7 })
    expect(view.look.logoUrl).toBe(`/api/public/portal-media/${LOGO_ASSET}`)
  })

  it('draws a table tent with the photo, the logo and both languages', async () => {
    const { make, ctx } = await harness()

    const file = await make(
      {
        portalId: COMPLETE_SCENARIO.portalId,
        piece: 'table_tent',
        languages: ['bg', 'en'],
        callToAction: 'rate',
      },
      ctx,
    )

    const text = Buffer.from(file.pdf).toString('latin1')
    expect(file.fileName).toMatch(/-table-tent\.pdf$/u)
    expect(text.startsWith('%PDF-')).toBe(true)
    // The photo and the logo, one picture each, however many panels show them.
    expect(text.match(/\/Subtype \/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The Bulgarian call to action reached the file as embedded text.
    expect(text).toMatch(/<041E>/iu)
  })

  it('does not make a print for a Portal of another organization', async () => {
    const { make } = await harness()
    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['en'],
          callToAction: 'rate',
        },
        buildTestAuthContext({ organizationId: organizationId('org-other-0000-0000') }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('does not offer a language the Portal does not have', async () => {
    const { make, ctx } = await harness()
    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['fr'],
          callToAction: 'rate',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
  })
})
