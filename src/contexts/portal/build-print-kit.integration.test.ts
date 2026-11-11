// Exercises the composed print read and real PDF download, including last-print memory.

import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalLastPrintRepository } from './infrastructure/repositories/portal-last-print.repository'
import { createPortalPrintWordingRepository } from './infrastructure/repositories/portal-print-wording.repository'
import { createPortalMediaAssetRepository } from './infrastructure/repositories/portal-media-asset.repository'
import { createPortalReadsWorld } from './infrastructure/testing/portal-reads-world'
import { immersiveConfiguration } from './domain/__fixtures__/immersive-configuration'
import type { PortalPublicationSnapshot } from './domain/portal-publication-snapshot'
import { buildPortalPrintKit } from './build-print-kit'
import type { RevealPortalAddress } from './application/use-cases/reveal-portal-address'

const world = createPortalReadsWorld('build-print-kit')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portal_last_prints', 'portal_print_wordings', 'portals', 'properties'],
})

const ADDRESS =
  'https://app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?accessArtifact=11111111-1111-4111-8111-111111111111'

const SHORT_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

const base = immersiveConfiguration()

async function wire(country: string | null = null, address: string = ADDRESS) {
  const portal = world.portal({ name: 'Harbor lobby' })
  await world.seed([portal])
  const portalRepo = world.portalRepo()
  const reveal = vi.fn<RevealPortalAddress>(async () => ({
    publicUrl: address,
    publicUrls: { qr: address, nfc: address, direct: address.split('?')[0] ?? address },
    version: 1,
    issuedAt: new Date('2026-10-01T10:00:00Z'),
  }))
  const logger = { warn: vi.fn(), info: vi.fn() }
  const useCases = buildPortalPrintKit({
    portalRepo,
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    } as StaffPublicApi,
    publicationRepo: {
      loadWorkingCopy: async () => null,
      loadWorkingCopyWithLook: async () => null,
      // A live look with no photo and no logo, so no picture is read from the store.
      findActiveForPortal: async () =>
        ({
          id: 'snapshot-1',
          version: 1,
          configuration: immersiveConfiguration({
            brandProfile: { ...base.brandProfile, hero: null, logo: null },
          }),
        }) as PortalPublicationSnapshot,
    },
    mediaRepo: createPortalMediaAssetRepository(getDb()),
    lastPrintRepo: createPortalLastPrintRepository(getDb()),
    wordingRepo: createPortalPrintWordingRepository(getDb()),
    objectStore: createInMemoryObjectStore(),
    revealAddress: reveal,
    propertyCountry: async () => country,
    clock: () => new Date('2026-10-01T10:00:00Z'),
    logger,
  })
  return { portal, useCases, reveal, logger }
}

describe('buildPortalPrintKit', () => {
  it('reads the print kit for the preview', async () => {
    const { portal, useCases } = await wire()
    const view = await useCases.getPortalPrintKit({ portalId: portal.id }, world.ctx())
    expect(view.locales).toEqual(['en', 'bg'])
    expect(view.kit).toBe('final')
  })

  it('always reads the current print kit without a rollout setting', async () => {
    const { portal, useCases } = await wire()
    const view = await useCases.getPortalPrintKit({ portalId: portal.id }, world.ctx())
    expect(view.kit).toBe('final')
  })

  it('remembers a final print as the last, and tells the Share tab of it', async () => {
    const { portal, useCases } = await wire('US', SHORT_ADDRESS)
    const ctx = world.ctx()
    expect(
      (await useCases.getPortalPrintKit({ portalId: portal.id }, ctx)).lastPrint,
    ).toBe(null)

    await useCases.createPortalPrintFinal(
      {
        portalId: portal.id,
        piece: 'counter',
        orientation: 'upright',
        look: 'paper',
        printer: 'my_printer',
        quantity: 6,
        languages: ['en'],
        callToAction: 'how_did_we_do',
      },
      ctx,
    )

    const { lastPrint } = await useCases.getPortalPrintKit({ portalId: portal.id }, ctx)
    expect(lastPrint).toMatchObject({
      printedAt: '2026-10-01T10:00:00.000Z',
      settings: {
        piece: 'counter',
        orientation: 'upright',
        paper: 'letter',
        quantity: 6,
      },
      photo: { kind: 'same' },
    })
    expect(JSON.stringify(lastPrint)).not.toContain(SHORT_ADDRESS)
  })

  it('draws a real PDF on the Property country’s paper for the live code', async () => {
    const { portal, useCases, reveal } = await wire('CA', SHORT_ADDRESS)
    const file = await useCases.createPortalPrintFinal(
      {
        portalId: portal.id,
        piece: 'counter',
        orientation: 'upright',
        look: 'paper',
        printer: 'my_printer',
        quantity: 6,
        languages: ['en'],
        callToAction: 'how_did_we_do',
      },
      world.ctx(),
    )
    expect(Buffer.from(file.pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(file.fileName).toContain('letter')
    expect(reveal).toHaveBeenCalledWith(
      { portalId: portal.id, purpose: 'download' },
      expect.anything(),
    )
  })
})
