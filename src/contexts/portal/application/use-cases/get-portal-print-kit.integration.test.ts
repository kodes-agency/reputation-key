// Portal context — the print kit read (round 4, slice 45).

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { createPortalLastPrintRepository } from '../../infrastructure/repositories/portal-last-print.repository'
import { createPortalPrintWordingRepository } from '../../infrastructure/repositories/portal-print-wording.repository'
import { createPortalMediaAssetRepository } from '../../infrastructure/repositories/portal-media-asset.repository'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import { portalMediaAssetId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { PrintLastSettings } from '#/shared/domain/portal-print-last'
import type { PrintSavedWording } from '#/shared/domain/portal-print-wording'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import type {
  PortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import { getPortalPrintKit } from './get-portal-print-kit'

const world = createPortalReadsWorld('print-kit')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: [
    'portal_last_prints',
    'portal_print_wordings',
    'portal_media_assets',
    'portals',
    'properties',
  ],
})

const staffApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const LAST_SETTINGS: PrintLastSettings = {
  piece: 'tent',
  orientation: 'wide',
  look: 'immersive',
  paper: 'letter',
  printer: 'my_printer',
  quantity: 10,
  fillSpares: false,
  perSheet: null,
  cropMarks: false,
  backPage: false,
  languages: ['en', 'bg'],
  callToAction: 'how_did_we_do',
  customWords: null,
}
const PRINTED_AT = new Date('2026-10-12T09:00:00.000Z')
const OTHER_PHOTO = randomUUID()
// The live page names this suite's own photograph, not the shared fixture id.
const HERO = randomUUID()
const liveConfiguration = () => {
  const { brandProfile } = immersiveConfiguration()
  return immersiveConfiguration({
    brandProfile: {
      ...brandProfile,
      hero: brandProfile.hero && { ...brandProfile.hero, assetId: HERO },
    },
  })
}

async function setup(
  options: Readonly<{
    source?: PortalPublicationSource | null
    /** What is live: the Immersive Hub fixture unless told otherwise; null for nothing live. */
    live?: PortalPublicationConfiguration | null
    accessible?: readonly PropertyId[] | null
    /** The photo the Property's look holds, uploaded at this instant; the hero fixture's own unless told otherwise. */
    heroUploadedAt?: Date
    /** What the Portal's last print was made with: nothing remembered unless told otherwise. */
    last?: Readonly<{
      settings?: Partial<PrintLastSettings>
      photoAssetId?: string | null
      printedAt?: Date
    }>
    /** The wording the Portal saved for Share to open on: none unless told otherwise. */
    saved?: PrintSavedWording
  }> = {},
) {
  const portal = world.portal({ name: 'Harbor lobby' })
  const portalRepo = world.portalRepo()
  await world.seed([portal])
  const mediaRepo = createPortalMediaAssetRepository(getDb())
  await world.seedMedia([
    buildTestPortalMediaAsset({
      id: portalMediaAssetId(HERO),
      organizationId: world.orgA,
      propertyId: world.propertyA,
      purpose: 'hero',
      createdAt: options.heroUploadedAt ?? new Date('2026-10-01T09:00:00.000Z'),
    }),
  ])
  const wordingRepo = createPortalPrintWordingRepository(getDb())
  if (options.saved !== undefined) {
    await wordingRepo.save({
      organizationId: world.orgA,
      propertyId: portal.propertyId,
      portalId: portal.id,
      wording: options.saved,
      savedAt: PRINTED_AT,
    })
  }
  const last = options.last
  const lastPrintRepo = createPortalLastPrintRepository(getDb())
  if (last !== undefined) {
    await lastPrintRepo.record({
      organizationId: world.orgA,
      propertyId: portal.propertyId,
      portalId: portal.id,
      printedAt: last.printedAt ?? PRINTED_AT,
      settings: { ...LAST_SETTINGS, ...last.settings },
      photo:
        last.photoAssetId === null
          ? null
          : { assetId: last.photoAssetId ?? HERO, focalX: 0.4, focalY: 0.6 },
    })
  }
  const read = getPortalPrintKit({
    portalRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    publicationRepo: {
      loadWorkingCopy: async () =>
        options.source === undefined ? publicationSource() : options.source,
      findActiveForPortal: async () =>
        options.live === null
          ? null
          : ({
              id: 'snapshot-1',
              version: 1,
              configuration: options.live ?? liveConfiguration(),
            } as PortalPublicationSnapshot),
    },
    mediaRepo,
    lastPrintRepo,
    wordingRepo,
  })
  return { portal, read }
}

describe('getPortalPrintKit', () => {
  it('gives the preview the titles, languages and look of the live version', async () => {
    const { portal, read } = await setup()
    const view = await read({ portalId: portal.id }, world.ctx())
    expect(view.portalId).toBe(portal.id)
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.titles.bg).toBe('Разкажете ни за посещението си')
    expect(view.look.wordmark).toBe('HARBOR')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${HERO}`)
  })

  it('offers no language that is only in the editor, and shows the live look', async () => {
    const draft = publicationSource().look
    if (draft === null) throw new Error('fixture has a look')
    const { portal, read } = await setup({
      source: publicationSource({
        localeSet: ['en', 'bg', 'es'],
        look: { ...draft, wordmark: 'DRAFT' },
      }),
    })
    const view = await read({ portalId: portal.id }, world.ctx())
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.look.wordmark).toBe('HARBOR')
  })

  it('has nothing to show for a Portal with nothing live', async () => {
    const { portal, read } = await setup({ live: null })
    await expect(read({ portalId: portal.id }, world.ctx())).rejects.toMatchObject({
      code: 'publication_snapshot_unavailable',
    })
  })

  it('carries no address: the preview draws a placeholder code', async () => {
    const { portal, read } = await setup()
    const view = await read({ portalId: portal.id }, world.ctx())
    // Neither the long address nor a short print address (ADR 0069) is in the read.
    expect(JSON.stringify(view)).not.toMatch(
      /accessArtifact|\/p\/pt_|up\.railway|\/p\/[0-9A-HJKMNP-TV-Z]{20}/iu,
    )
  })

  describe('the last print', () => {
    const readFinal = async (options: Parameters<typeof setup>[0] = {}) => {
      const { portal, read } = await setup(options)
      return read({ portalId: portal.id }, world.ctx())
    }

    it('is null for a Portal that was never printed', async () => {
      expect((await readFinal()).lastPrint).toBeNull()
    })

    it('carries what was printed and when, the photo unchanged', async () => {
      const view = await readFinal({ last: {} })

      expect(view.lastPrint).toEqual({
        printedAt: PRINTED_AT.toISOString(),
        settings: LAST_SETTINGS,
        photo: { kind: 'same' },
      })
    })

    it('says a photo uploaded since the print changed on the day it was uploaded', async () => {
      const uploaded = new Date('2026-10-20T08:00:00.000Z')

      const view = await readFinal({
        last: { photoAssetId: OTHER_PHOTO },
        heroUploadedAt: uploaded,
      })

      expect(view.lastPrint?.photo).toEqual({
        kind: 'changed',
        on: uploaded.toISOString(),
      })
    })

    it('says a photo chosen from the earlier uploads changed, with no day', async () => {
      const view = await readFinal({
        last: { photoAssetId: OTHER_PHOTO },
        heroUploadedAt: new Date('2026-09-01T08:00:00.000Z'),
      })

      expect(view.lastPrint?.photo).toEqual({ kind: 'changed', on: null })
    })

    it('has nothing to say about the photo of a Paper print', async () => {
      const view = await readFinal({
        last: { settings: { look: 'paper' }, photoAssetId: null },
        heroUploadedAt: new Date('2026-10-20T08:00:00.000Z'),
      })

      expect(view.lastPrint?.photo).toEqual({ kind: 'same' })
    })

    it('carries no address and no code', async () => {
      const view = await readFinal({ last: {} })

      expect(JSON.stringify(view.lastPrint)).not.toMatch(/railway|\/p\/|token|url/iu)
    })
  })

  describe('the saved wording', () => {
    const SAVED: PrintSavedWording = {
      callToAction: 'how_was_stay',
      customWords: { en: { headline: 'Thanks for staying', subline: 'Tell us more' } },
    }
    const readFinal = async (options: Parameters<typeof setup>[0] = {}) => {
      const { portal, read } = await setup(options)
      return read({ portalId: portal.id }, world.ctx())
    }

    it('is null for a Portal that saved none', async () => {
      expect((await readFinal()).savedWording).toBeNull()
    })

    it('carries the wording and the own words the Portal saved', async () => {
      expect((await readFinal({ saved: SAVED })).savedWording).toEqual(SAVED)
    })

    it('stands beside the last print, which keeps its own wording', async () => {
      const view = await readFinal({ saved: SAVED, last: {} })
      expect(view.savedWording).toEqual(SAVED)
      expect(view.lastPrint?.settings.callToAction).toBe('how_did_we_do')
    })
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { portal, read } = await setup()
    await expect(
      read({ portalId: portal.id }, world.ctx({ effectivePermissions: new Set() })),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, read } = await setup({
      accessible: [propertyId(randomUUID())],
    })
    await expect(read({ portalId: portal.id }, world.ctx())).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('does not find a Portal of another organization', async () => {
    const { portal, read } = await setup()
    await expect(read({ portalId: portal.id }, world.ctxB())).rejects.toMatchObject({
      code: 'portal_not_found',
    })
  })

  it('does not find a Portal whose working copy does not resolve, for a live version that needs it', async () => {
    const { portal, read } = await setup({
      source: null,
      live: {
        schemaVersion: 2,
        localeSet: ['en'],
      } as unknown as PortalPublicationConfiguration,
    })
    await expect(read({ portalId: portal.id }, world.ctx())).rejects.toMatchObject({
      code: 'portal_not_found',
    })
  })
})
