// Portal context — the print kit read (round 4, slice 45).

import { describe, expect, it } from 'vitest'
import { createInMemoryPortalLastPrintRepo } from '#/shared/testing/in-memory-portal-last-print-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalMediaAssetId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  immersiveConfiguration,
  IMMERSIVE_HERO_ASSET_ID,
} from '../../domain/__fixtures__/immersive-configuration'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import type {
  PortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import { getPortalPrintKit } from './get-portal-print-kit'

const staffApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const LAST_SETTINGS: PrintFinalLastSettings = {
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
  callToAction: 'rate',
}
const PRINTED_AT = new Date('2026-10-12T09:00:00.000Z')
const OTHER_PHOTO = '70000000-0000-4000-8000-0000000000aa'

function setup(
  options: Readonly<{
    source?: PortalPublicationSource | null
    /** What is live: the Immersive Hub fixture unless told otherwise; null for nothing live. */
    live?: PortalPublicationConfiguration | null
    accessible?: readonly PropertyId[] | null
    finalKit?: boolean
    /** The photo the Property's look holds, uploaded at this instant; the hero fixture's own unless told otherwise. */
    heroUploadedAt?: Date
    /** What the Portal's last print was made with: nothing remembered unless told otherwise. */
    last?: Readonly<{
      settings?: Partial<PrintFinalLastSettings>
      photoAssetId?: string | null
      printedAt?: Date
    }>
  }> = {},
) {
  const portal = buildTestPortal({ name: 'Harbor lobby' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  mediaRepo.seed([
    buildTestPortalMediaAsset({
      id: portalMediaAssetId(IMMERSIVE_HERO_ASSET_ID),
      purpose: 'hero',
      createdAt: options.heroUploadedAt ?? new Date('2026-10-01T09:00:00.000Z'),
    }),
  ])
  const last = options.last
  const lastPrintRepo = createInMemoryPortalLastPrintRepo(
    last === undefined
      ? []
      : [
          {
            organizationId: buildTestAuthContext().organizationId,
            propertyId: portal.propertyId,
            portalId: portal.id,
            printedAt: last.printedAt ?? PRINTED_AT,
            settings: { ...LAST_SETTINGS, ...last.settings },
            photo:
              last.photoAssetId === null
                ? null
                : {
                    assetId: last.photoAssetId ?? IMMERSIVE_HERO_ASSET_ID,
                    focalX: 0.4,
                    focalY: 0.6,
                  },
          },
        ],
  )
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
              configuration: options.live ?? immersiveConfiguration(),
            } as PortalPublicationSnapshot),
    },
    mediaRepo,
    lastPrintRepo,
    finalKitEnabled: options.finalKit ?? false,
  })
  return { portal, read }
}

describe('getPortalPrintKit', () => {
  it('gives the preview the titles, languages and look of the live version', async () => {
    const { portal, read } = setup()
    const view = await read({ portalId: portal.id }, buildTestAuthContext())
    expect(view.portalId).toBe(portal.id)
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.titles.bg).toBe('Разкажете ни за посещението си')
    expect(view.look.wordmark).toBe('HARBOR')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${IMMERSIVE_HERO_ASSET_ID}`)
  })

  it('offers no language that is only in the editor, and shows the live look', async () => {
    const draft = publicationSource().look
    if (draft === null) throw new Error('fixture has a look')
    const { portal, read } = setup({
      source: publicationSource({
        localeSet: ['en', 'bg', 'es'],
        look: { ...draft, wordmark: 'DRAFT' },
      }),
    })
    const view = await read({ portalId: portal.id }, buildTestAuthContext())
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.look.wordmark).toBe('HARBOR')
  })

  it('has nothing to show for a Portal with nothing live', async () => {
    const { portal, read } = setup({ live: null })
    await expect(
      read({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('carries no address: the preview draws a placeholder code', async () => {
    const { portal, read } = setup()
    const view = await read({ portalId: portal.id }, buildTestAuthContext())
    // Neither the long address nor a short print address (ADR 0069) is in the read.
    expect(JSON.stringify(view)).not.toMatch(
      /accessArtifact|\/p\/pt_|up\.railway|\/p\/[0-9A-HJKMNP-TV-Z]{20}/iu,
    )
  })

  describe('the last print', () => {
    const readFinal = async (options: Parameters<typeof setup>[0] = {}) => {
      const { portal, read } = setup({ finalKit: true, ...options })
      return read({ portalId: portal.id }, buildTestAuthContext())
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

    it('is not read while the server shows today’s kit', async () => {
      const view = await readFinal({ finalKit: false, last: {} })

      expect(view.kit).toBe('current')
      expect(view.lastPrint).toBeNull()
    })

    it('carries no address and no code', async () => {
      const view = await readFinal({ last: {} })

      expect(JSON.stringify(view.lastPrint)).not.toMatch(/railway|\/p\/|token|url/iu)
    })
  })

  it('refuses a caller who holds no Portal read permission', async () => {
    const { portal, read } = setup()
    await expect(
      read(
        { portalId: portal.id },
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, read } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })
    await expect(
      read({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { portal, read } = setup()
    await expect(
      read(
        { portalId: portal.id },
        buildTestAuthContext({ organizationId: organizationId('org-other') }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('does not find a Portal whose working copy does not resolve, for a live version that needs it', async () => {
    const { portal, read } = setup({
      source: null,
      live: {
        schemaVersion: 2,
        localeSet: ['en'],
      } as unknown as PortalPublicationConfiguration,
    })
    await expect(
      read({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
