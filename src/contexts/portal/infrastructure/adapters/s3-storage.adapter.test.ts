import { describe, expect, it } from 'vitest'
import {
  buildPortalBoundReadInput,
  buildPortalIssuedPutInput,
  buildS3ClientConfigs,
  portalDerivativeObjectKey,
} from './s3-storage.adapter'
import { createPortalHeroUploadIssuance } from '../../domain/upload-issuance'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

const base = {
  accessKey: 'access',
  secretKey: 'secret',
  bucketName: 'bucket',
  region: 'us-east-1',
}

describe('buildS3ClientConfigs', () => {
  it('preserves AWS endpoint discovery when overrides are absent', () => {
    const result = buildS3ClientConfigs(base)
    expect(result.internal).not.toHaveProperty('endpoint')
    expect(result.presign).not.toHaveProperty('endpoint')
    expect(result.internal.forcePathStyle).toBe(false)
  })

  it('splits private operations from browser-reachable signatures', () => {
    const result = buildS3ClientConfigs({
      ...base,
      internalEndpoint: 'http://object-store:9000',
      presignEndpoint: 'http://127.0.0.1:4900',
      forcePathStyle: true,
    })
    expect(result.internal).toMatchObject({
      endpoint: 'http://object-store:9000',
      forcePathStyle: true,
    })
    expect(result.presign).toMatchObject({
      endpoint: 'http://127.0.0.1:4900',
      forcePathStyle: true,
    })
  })

  it('falls back to the internal endpoint for signatures when no public override is set', () => {
    const result = buildS3ClientConfigs({
      ...base,
      internalEndpoint: 'http://object-store:9000',
      forcePathStyle: true,
    })
    expect(result.presign.endpoint).toBe('http://object-store:9000')
  })
})

describe('portalDerivativeObjectKey', () => {
  it('derives new public variant keys from the opaque issuance, not from caller input', () => {
    // @proof PORTAL_UPLOAD_FOREIGN_KEY#1
    const issuance = createPortalHeroUploadIssuance({
      id: '70000000-0000-4000-8000-000000000001',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
      portalId: portalId('a0000000-0000-4000-8000-000000000002'),
      contentType: 'image/png',
      declaredSizeBytes: 1024,
      now: new Date('2026-08-26T12:00:00.000Z'),
    })
    if (!issuance) throw new Error('test issuance must be valid')

    expect(portalDerivativeObjectKey(issuance, 'hero')).toBe(
      'public/portal-heroes/70000000-0000-4000-8000-000000000001/hero.webp',
    )
    expect(portalDerivativeObjectKey(issuance, 'thumbnail')).toBe(
      'public/portal-heroes/70000000-0000-4000-8000-000000000001/thumbnail.webp',
    )
    expect(portalDerivativeObjectKey(issuance, 'hero')).not.toBe(issuance.objectKey)
  })

  it('makes the browser upload first-write-only and binds worker reads to the verified ETag', () => {
    // @proof PORTAL_UPLOAD_FOREIGN_KEY#2
    const issuance = createPortalHeroUploadIssuance({
      id: '70000000-0000-4000-8000-000000000001',
      organizationId: organizationId('org-1'),
      propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
      portalId: portalId('a0000000-0000-4000-8000-000000000002'),
      contentType: 'image/png',
      declaredSizeBytes: 1024,
      now: new Date('2026-08-26T12:00:00.000Z'),
    })
    if (!issuance) throw new Error('test issuance must be valid')

    expect(buildPortalIssuedPutInput('bucket', issuance)).toMatchObject({
      Bucket: 'bucket',
      Key: issuance.objectKey,
      IfNoneMatch: '*',
    })
    expect(
      buildPortalBoundReadInput(
        'bucket',
        { ...issuance, state: 'consumed' },
        '"d41d8cd98f00b204e9800998ecf8427e"',
      ),
    ).toMatchObject({
      Bucket: 'bucket',
      Key: issuance.objectKey,
      IfMatch: '"d41d8cd98f00b204e9800998ecf8427e"',
    })
  })
})
