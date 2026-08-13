import { describe, expect, it } from 'vitest'
import { buildS3ClientConfigs } from './s3-storage.adapter'

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
