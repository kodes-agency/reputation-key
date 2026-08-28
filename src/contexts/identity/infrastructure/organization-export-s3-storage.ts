import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import type { OrganizationExportStorage } from '../application/ports/organization-export.port'

const OBJECT_KEY =
  /^private\/organization-exports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/iu
const SHA256 = /^[a-f0-9]{64}$/u

export type OrganizationExportS3Config = Readonly<{
  accessKey: string
  secretKey: string
  bucketName: string
  region: string
  internalEndpoint?: string
  forcePathStyle?: boolean
}>

function assertObjectKey(value: string): string {
  if (!OBJECT_KEY.test(value)) {
    throw new Error('Organization Export object key is outside the private namespace')
  }
  return value
}

export function buildEncryptedOrganizationExportPutInput(input: {
  bucketName: string
  objectKey: string
  bytes: Uint8Array
  archiveSha256: string
  deleteAfter: Date
}): PutObjectCommandInput {
  if (!SHA256.test(input.archiveSha256)) {
    throw new Error('Organization Export archive checksum is invalid')
  }
  if (Number.isNaN(input.deleteAfter.getTime())) {
    throw new Error('Organization Export deletion deadline is invalid')
  }
  return {
    Bucket: input.bucketName,
    Key: assertObjectKey(input.objectKey),
    Body: input.bytes,
    ContentType: 'application/zip',
    ServerSideEncryption: 'AES256',
    IfNoneMatch: '*',
    Metadata: {
      'archive-sha256': input.archiveSha256,
      'delete-after': input.deleteAfter.toISOString(),
      'export-format': 'organization-export-v1',
    },
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate.name === 'NotFound' ||
    candidate.Code === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate.name === 'PreconditionFailed' ||
    candidate.Code === 'PreconditionFailed' ||
    candidate.$metadata?.httpStatusCode === 412
  )
}

export class S3OrganizationExportStorage implements OrganizationExportStorage {
  static create(config: OrganizationExportS3Config): S3OrganizationExportStorage {
    const required = [
      ['accessKey', config.accessKey],
      ['secretKey', config.secretKey],
      ['bucketName', config.bucketName],
      ['region', config.region],
    ] as const
    for (const [name, value] of required) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Organization Export S3 ${name} is required`)
      }
    }
    const client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
      ...(config.internalEndpoint ? { endpoint: config.internalEndpoint } : {}),
    })
    return new S3OrganizationExportStorage(client, config.bucketName)
  }

  private constructor(
    private readonly client: S3Client,
    private readonly bucketName: string,
  ) {}

  async putEncrypted(input: {
    objectKey: string
    bytes: Uint8Array
    archiveSha256: string
    contentType: 'application/zip'
    deleteAfter: Date
  }): Promise<{
    outcome: 'stored' | 'already_present_exact'
    encryptionEvidenceRef: string
  }> {
    const command = buildEncryptedOrganizationExportPutInput({
      bucketName: this.bucketName,
      ...input,
    })
    try {
      await this.client.send(new PutObjectCommand(command))
      return {
        outcome: 'stored',
        encryptionEvidenceRef: `s3:aes256:${input.archiveSha256}`,
      }
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error
      const existing = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: assertObjectKey(input.objectKey),
        }),
      )
      if (
        existing.ServerSideEncryption !== 'AES256' ||
        existing.ContentType !== 'application/zip' ||
        existing.ContentLength !== input.bytes.byteLength ||
        existing.Metadata?.['archive-sha256'] !== input.archiveSha256 ||
        existing.Metadata?.['delete-after'] !== input.deleteAfter.toISOString()
      ) {
        throw new Error('Organization Export object key is bound to different bytes', {
          cause: error,
        })
      }
      return {
        outcome: 'already_present_exact',
        encryptionEvidenceRef: `s3:aes256:${input.archiveSha256}`,
      }
    }
  }

  async readEncrypted(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: assertObjectKey(objectKey),
      }),
    )
    if (
      result.ServerSideEncryption !== 'AES256' ||
      result.ContentType !== 'application/zip' ||
      !result.Body
    ) {
      throw new Error('Organization Export object encryption evidence is invalid')
    }
    return result.Body.transformToByteArray()
  }

  async delete(objectKey: string): Promise<{ deletionEvidenceRef: string }> {
    const key = assertObjectKey(objectKey)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }))
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }))
    } catch (error) {
      if (isNotFound(error)) {
        return {
          deletionEvidenceRef: `s3:delete-verified:${key.slice(
            'private/organization-exports/'.length,
            -'.zip'.length,
          )}`,
        }
      }
      throw error
    }
    throw new Error('Organization Export object remains after deletion')
  }
}
