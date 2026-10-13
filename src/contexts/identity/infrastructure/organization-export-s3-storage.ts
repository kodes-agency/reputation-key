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

/**
 * How long one call to the store may take, from the request to the last byte
 * of its answer. The SDK sets no request timeout of its own, so a store that
 * accepts the connection and then goes quiet would hold the export worker for
 * as long as the socket lived. An archive is at most 128 MiB (the archive
 * writer's cap), so the deadline is sized for that upload or download.
 */
const ORGANIZATION_EXPORT_OBJECT_DEADLINE_MS = 120_000

export type OrganizationExportS3Config = Readonly<{
  accessKey: string
  secretKey: string
  bucketName: string
  region: string
  internalEndpoint?: string
  forcePathStyle?: boolean
  /** Overrides ORGANIZATION_EXPORT_OBJECT_DEADLINE_MS; the tests use a short one. */
  requestDeadlineMs?: number
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
    return new S3OrganizationExportStorage(
      client,
      config.bucketName,
      config.requestDeadlineMs ?? ORGANIZATION_EXPORT_OBJECT_DEADLINE_MS,
    )
  }

  private constructor(
    private readonly client: S3Client,
    private readonly bucketName: string,
    private readonly deadlineMs: number,
  ) {}

  /**
   * One signal per call. It aborts the request and, for a read, the body that
   * follows the headers: the SDK destroys the socket the body arrives on.
   */
  private withinDeadline(): { abortSignal: AbortSignal } {
    return { abortSignal: AbortSignal.timeout(this.deadlineMs) }
  }

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
      await this.client.send(new PutObjectCommand(command), this.withinDeadline())
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
        this.withinDeadline(),
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

  /**
   * HEAD-only egress-evidence probe used by generation recovery.
   *
   * It never downloads the archive and never rebuilds one: it only answers
   * whether the exact bytes recorded before egress are present under the
   * deterministic key, so an ambiguous post-upload crash can converge.
   */
  async verifyStored(input: {
    objectKey: string
    archiveSha256: string
  }): Promise<
    | Readonly<{ outcome: 'present_exact'; encryptionEvidenceRef: string }>
    | Readonly<{ outcome: 'absent' }>
    | Readonly<{ outcome: 'mismatch' }>
  > {
    if (!SHA256.test(input.archiveSha256)) {
      throw new Error('Organization Export archive checksum is invalid')
    }
    const key = assertObjectKey(input.objectKey)
    let existing
    try {
      existing = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
        this.withinDeadline(),
      )
    } catch (error) {
      if (isNotFound(error)) return { outcome: 'absent' }
      throw error
    }
    if (
      existing.ServerSideEncryption !== 'AES256' ||
      existing.ContentType !== 'application/zip' ||
      existing.Metadata?.['archive-sha256'] !== input.archiveSha256
    ) {
      return { outcome: 'mismatch' }
    }
    return {
      outcome: 'present_exact',
      encryptionEvidenceRef: `s3:aes256:${input.archiveSha256}`,
    }
  }

  async readEncrypted(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: assertObjectKey(objectKey),
      }),
      this.withinDeadline(),
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
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      this.withinDeadline(),
    )
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
        this.withinDeadline(),
      )
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
