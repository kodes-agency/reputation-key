import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import type { RevealPortalAddress } from '../application/use-cases/reveal-portal-address'
import { StoredObjectTooLargeError } from '../application/ports/storage.port'
import { printKitDownloadOf, readPicturesThenReveal } from './print-download.server'

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const ADDRESS = 'HTTPS://AP.EXAMPLE.TEST/p/7K3QZ0VD9MWX4HT2BN6R'
const HERO = Buffer.from('hero image bytes')
const LOGO = Buffer.from('logo image bytes')

async function setup() {
  const ctx = buildTestAuthContext()
  const hero = buildTestPortalMediaAsset({
    id: portalMediaAssetId('70000000-0000-4000-8000-000000000001'),
    purpose: 'hero',
    byteSize: HERO.length,
    contentSha256: sha256Hex(HERO),
  })
  const logo = buildTestPortalMediaAsset({
    id: portalMediaAssetId('70000000-0000-4000-8000-000000000002'),
    purpose: 'logo',
    byteSize: LOGO.length,
    contentSha256: sha256Hex(LOGO),
  })
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  mediaRepo.seed([hero, logo])
  const objectStore = createInMemoryObjectStore()
  await objectStore.putObject(hero.objectKey, HERO, 'image/webp')
  await objectStore.putObject(logo.objectKey, LOGO, 'image/webp')
  const revealAddress = vi.fn<RevealPortalAddress>(async () => ({
    publicUrl: ADDRESS,
    publicUrls: { qr: ADDRESS, nfc: ADDRESS, direct: ADDRESS },
    version: 1,
    issuedAt: new Date('2026-10-01T10:00:00Z'),
  }))
  const deps = { mediaRepo, objectStore, sha256Hex, revealAddress }
  const look = {
    hero: { assetId: hero.id, width: 1600, height: 1000, focalX: 0.4, focalY: 0.6 },
    logo: { assetId: logo.id },
  }
  const read = (chosen = look) =>
    readPicturesThenReveal(
      deps,
      chosen,
      { organizationId: ctx.organizationId, propertyId: hero.propertyId },
      ctx,
      { portalId: 'portal-1' },
    )
  return { ctx, hero, logo, deps, look, read }
}

describe('print download pictures', () => {
  it('reads the checked media bytes and focal point before the audited download reveal', async () => {
    const { ctx, deps, read } = await setup()
    expect(await read()).toEqual({
      photo: { bytes: new Uint8Array(HERO), focalX: 0.4, focalY: 0.6 },
      logo: new Uint8Array(LOGO),
      qrAddress: ADDRESS,
    })
    expect(deps.revealAddress).toHaveBeenCalledExactlyOnceWith(
      { portalId: 'portal-1', purpose: 'download' },
      ctx,
    )
  })

  it.each(['missing', 'changed', 'oversized'] as const)(
    'refuses a %s object before disclosing the address',
    async (fault) => {
      const { hero, deps, read } = await setup()
      if (fault === 'missing') await deps.objectStore.deleteObject(hero.objectKey)
      if (fault === 'changed') {
        await deps.objectStore.putObject(
          hero.objectKey,
          Buffer.from('changed content!'),
          'image/webp',
        )
      }
      if (fault === 'oversized') {
        vi.spyOn(deps.objectStore, 'getObject').mockRejectedValue(
          new StoredObjectTooLargeError(),
        )
      }
      await expect(read()).rejects.toMatchObject({ code: 'media_not_found' })
      expect(deps.revealAddress).not.toHaveBeenCalled()
    },
  )

  it('omits a taken-down picture and still reveals the live address', async () => {
    const { hero, deps, read } = await setup()
    deps.mediaRepo.seed([{ ...hero, status: 'taken_down' }])
    expect(await read()).toMatchObject({
      photo: null,
      logo: new Uint8Array(LOGO),
      qrAddress: ADDRESS,
    })
  })
})

it('serializes PDF bytes without changing the file name or type', () => {
  const file = {
    fileName: 'portal.pdf',
    contentType: 'application/pdf' as const,
    pdf: new Uint8Array([0, 127, 255]),
  }
  const download = printKitDownloadOf(file)
  expect(download).toEqual({
    fileName: file.fileName,
    contentType: file.contentType,
    pdfBase64: 'AH//',
  })
  expect(Buffer.from(download.pdfBase64, 'base64')).toEqual(Buffer.from(file.pdf))
})
