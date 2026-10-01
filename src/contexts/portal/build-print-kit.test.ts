// Portal context — the print kit's wiring (round 4, slice 45): the context build
// hands the two use cases out, and the one that draws is wired to the real
// PDFKit renderer, to the audited reveal and to the hash check on stored images.

import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { immersiveConfiguration } from './domain/__fixtures__/immersive-configuration'
import type { PortalPublicationSnapshot } from './domain/portal-publication-snapshot'
import { buildPortalPrintKit } from './build-print-kit'
import type { RevealPortalAddress } from './application/use-cases/reveal-portal-address'

const ADDRESS =
  'https://app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?accessArtifact=11111111-1111-4111-8111-111111111111'

const base = immersiveConfiguration()

function wire() {
  const portal = buildTestPortal({ name: 'Harbor lobby' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const reveal = vi.fn<RevealPortalAddress>(async () => ({
    publicUrl: ADDRESS,
    publicUrls: { qr: ADDRESS, nfc: ADDRESS },
    version: 1,
    issuedAt: new Date('2026-10-01T10:00:00Z'),
  }))
  const useCases = buildPortalPrintKit({
    portalRepo,
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    } as StaffPublicApi,
    publicationRepo: {
      loadWorkingCopy: async () => null,
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
    mediaRepo: createInMemoryPortalMediaAssetRepo(),
    objectStore: createInMemoryObjectStore(),
    revealAddress: reveal,
    clock: () => new Date('2026-10-01T10:00:00Z'),
  })
  return { portal, useCases, reveal }
}

describe('buildPortalPrintKit', () => {
  it('reads the print kit for the preview', async () => {
    const { portal, useCases } = wire()
    const view = await useCases.getPortalPrintKit(
      { portalId: portal.id },
      buildTestAuthContext(),
    )
    expect(view.locales).toEqual(['en', 'bg'])
  })

  it('draws a real PDF for the address of the live code', async () => {
    const { portal, useCases, reveal } = wire()
    const file = await useCases.createPortalPrintKit(
      {
        portalId: portal.id,
        piece: 'counter_card',
        languages: ['en'],
        callToAction: 'rate',
      },
      buildTestAuthContext(),
    )
    expect(Buffer.from(file.pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(file.fileName).toBe('harbor-lobby-counter-card.pdf')
    expect(reveal).toHaveBeenCalledWith(
      { portalId: portal.id, purpose: 'download' },
      expect.anything(),
    )
  })
})
