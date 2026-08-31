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

  describe('verifyStored egress-evidence probe', () => {
    const KEY = `private/organization-exports/${ID}.zip`
    const SHA = 'a'.repeat(64)

    function storage(send: (command: unknown) => Promise<unknown>) {
      const value = S3OrganizationExportStorage.create({
        accessKey: 'access',
        secretKey: 'secret',
        bucketName: 'private-cell-us',
        region: 'us-east-1',
      })
      // The client is private by construction; the probe's contract is what a
      // HEAD response means, so the transport is replaced rather than mocked
      // at the network level.
      ;(value as unknown as { client: { send: typeof send } }).client = { send }
      return value
    }

    it('reports present_exact only for the recorded checksum under private encryption', async () => {
      const sent: unknown[] = []
      const value = storage(async (command) => {
        sent.push(command)
        return {
          ServerSideEncryption: 'AES256',
          ContentType: 'application/zip',
          Metadata: { 'archive-sha256': SHA },
        }
      })

      await expect(
        value.verifyStored({ objectKey: KEY, archiveSha256: SHA }),
      ).resolves.toEqual({
        outcome: 'present_exact',
        encryptionEvidenceRef: `s3:aes256:${SHA}`,
      })
      // HEAD only: recovery must never pull the archive back through the app.
      expect(sent).toHaveLength(1)
      expect((sent[0] as { constructor: { name: string } }).constructor.name).toBe(
        'HeadObjectCommand',
      )
    })

    it('reports absent when the object was never uploaded', async () => {
      const value = storage(async () => {
        throw Object.assign(new Error('missing'), { name: 'NotFound' })
      })

      await expect(
        value.verifyStored({ objectKey: KEY, archiveSha256: SHA }),
      ).resolves.toEqual({ outcome: 'absent' })
    })

    it('reports mismatch when the key holds different or unencrypted bytes', async () => {
      const wrongDigest = storage(async () => ({
        ServerSideEncryption: 'AES256',
        ContentType: 'application/zip',
        Metadata: { 'archive-sha256': 'b'.repeat(64) },
      }))
      const unencrypted = storage(async () => ({
        ContentType: 'application/zip',
        Metadata: { 'archive-sha256': SHA },
      }))

      await expect(
        wrongDigest.verifyStored({ objectKey: KEY, archiveSha256: SHA }),
      ).resolves.toEqual({ outcome: 'mismatch' })
      await expect(
        unencrypted.verifyStored({ objectKey: KEY, archiveSha256: SHA }),
      ).resolves.toEqual({ outcome: 'mismatch' })
    })

    it('refuses a key outside the private namespace or a malformed checksum', async () => {
      const value = storage(async () => ({}))

      await expect(
        value.verifyStored({ objectKey: `public/${ID}.zip`, archiveSha256: SHA }),
      ).rejects.toThrow(/outside the private namespace/u)
      await expect(
        value.verifyStored({ objectKey: KEY, archiveSha256: 'nope' }),
      ).rejects.toThrow(/checksum is invalid/u)
    })

    it('propagates a transport failure instead of reporting absent', async () => {
      const value = storage(async () => {
        throw Object.assign(new Error('service unavailable'), {
          $metadata: { httpStatusCode: 503 },
        })
      })

      await expect(
        value.verifyStored({ objectKey: KEY, archiveSha256: SHA }),
      ).rejects.toThrow(/service unavailable/u)
    })
  })
})
