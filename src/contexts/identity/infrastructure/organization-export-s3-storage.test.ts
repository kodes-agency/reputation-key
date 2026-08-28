import { describe, expect, it } from 'vitest'
import {
  buildEncryptedOrganizationExportPutInput,
  S3OrganizationExportStorage,
} from './organization-export-s3-storage'

const ID = '18deca2e-91a7-46e4-b92b-73163568ed84'

describe('Organization Export private S3 contract', () => {
  it('binds immutable private ZIP bytes to encryption, checksum, and deletion metadata', () => {
    expect(
      buildEncryptedOrganizationExportPutInput({
        bucketName: 'private-cell-us',
        objectKey: `private/organization-exports/${ID}.zip`,
        bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
        archiveSha256: 'a'.repeat(64),
        deleteAfter: new Date('2026-09-04T12:00:00.000Z'),
      }),
    ).toEqual({
      Bucket: 'private-cell-us',
      Key: `private/organization-exports/${ID}.zip`,
      Body: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      ContentType: 'application/zip',
      ServerSideEncryption: 'AES256',
      IfNoneMatch: '*',
      Metadata: {
        'archive-sha256': 'a'.repeat(64),
        'delete-after': '2026-09-04T12:00:00.000Z',
        'export-format': 'organization-export-v1',
      },
    })
  })

  it('refuses arbitrary keys and malformed checksums', () => {
    expect(() =>
      buildEncryptedOrganizationExportPutInput({
        bucketName: 'private-cell-us',
        objectKey: `public/${ID}.zip`,
        bytes: Uint8Array.from([1]),
        archiveSha256: 'a'.repeat(64),
        deleteAfter: new Date('2026-09-04T12:00:00.000Z'),
      }),
    ).toThrow(/outside the private namespace/)
    expect(() =>
      buildEncryptedOrganizationExportPutInput({
        bucketName: 'private-cell-us',
        objectKey: `private/organization-exports/${ID}.zip`,
        bytes: Uint8Array.from([1]),
        archiveSha256: 'not-a-checksum',
        deleteAfter: new Date('2026-09-04T12:00:00.000Z'),
      }),
    ).toThrow(/checksum is invalid/)
  })

  it('fails closed when a required storage setting is absent at runtime', () => {
    expect(() =>
      S3OrganizationExportStorage.create({
        accessKey: undefined as unknown as string,
        secretKey: 'secret',
        bucketName: 'private-cell-us',
        region: 'us-east-1',
      }),
    ).toThrow(/accessKey is required/)
  })
})
