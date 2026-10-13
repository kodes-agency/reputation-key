// Portal context — S3-compatible object-storage adapter.
// Beta targets a private Railway bucket through its S3-compatible API; the
// repository-pinned AWS SDK is the protocol client, not a hosting claim.

import {
  S3Client,
  S3ServiceException,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  StoredObjectTooLargeError,
  type StoragePort,
} from '../../application/ports/storage.port'
import { portalError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

/**
 * How long one call to the store may take, from the request to the last byte
 * of its answer. The SDK sets no request timeout of its own, so a bucket that
 * accepts the connection and then goes quiet would hold every call open for as
 * long as the socket lived, the anonymous image read among them. Every object
 * this adapter moves is an image of at most 10 MiB, in the same region.
 */
const OBJECT_STORE_DEADLINE_MS = 15_000

export type S3StorageConfig = Readonly<{
  accessKey?: string
  secretKey?: string
  bucketName?: string
  region?: string
  internalEndpoint?: string
  presignEndpoint?: string
  forcePathStyle?: boolean
  /** Overrides OBJECT_STORE_DEADLINE_MS; the tests use a short one. */
  requestDeadlineMs?: number
}>

type ConfiguredS3Storage = Required<
  Pick<S3StorageConfig, 'accessKey' | 'secretKey' | 'bucketName' | 'region'>
> &
  S3StorageConfig

export function buildS3ClientConfigs(config: ConfiguredS3Storage) {
  const common = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
    // Only checksum what the protocol requires. The SDK default also signs the
    // checksum of an EMPTY body into a presigned upload URL, which a store that
    // checks it then refuses for any real file; and it adds checksum headers to
    // every server-side put, which S3-compatible stores do not all accept.
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    responseChecksumValidation: 'WHEN_REQUIRED' as const,
  }
  return {
    internal: {
      ...common,
      ...(config.internalEndpoint ? { endpoint: config.internalEndpoint } : {}),
    },
    presign: {
      ...common,
      ...(config.presignEndpoint || config.internalEndpoint
        ? { endpoint: config.presignEndpoint ?? config.internalEndpoint }
        : {}),
    },
  } as const
}

export const createS3StorageAdapter = (config: S3StorageConfig): StoragePort => {
  // If S3 is not configured, return a noop adapter
  if (!config.accessKey || !config.secretKey || !config.bucketName || !config.region) {
    return {
      createPresignedUploadUrl: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      confirmUpload: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      inspectObject: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      deleteObject: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      getObject: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      putObject: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
    }
  }

  const clients = buildS3ClientConfigs(config as ConfiguredS3Storage)
  const internalClient = new S3Client(clients.internal)
  const presignClient = new S3Client(clients.presign)
  const bucketName = config.bucketName
  const deadlineMs = config.requestDeadlineMs ?? OBJECT_STORE_DEADLINE_MS
  // One signal per call. It aborts the request and, for a read, the body that
  // follows the headers: the SDK destroys the socket the body arrives on.
  const withinDeadline = () => ({ abortSignal: AbortSignal.timeout(deadlineMs) })

  return {
    // The size bound is not part of the signature: a signed PUT cannot carry
    // a maximum length, and binding the exact length is unproven against the
    // stores this adapter talks to. The caller reads the stored size instead
    // (Identity's assertStoredUploadAllowed, at its finalize step and at the
    // avatar save). The address outlives that check: for the rest of its hour
    // it can replace the object, so a reader bounds its own read (`getObject`).
    createPresignedUploadUrl: async (key, contentType, _maxSizeBytes) => {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
      })

      const uploadUrl = await trace('s3.createPresignedUploadUrl', () =>
        getSignedUrl(presignClient, command, {
          expiresIn: 3600, // 1 hour
        }),
      )

      return { uploadUrl, key }
    },

    confirmUpload: async (key) => {
      await trace('s3.confirmUpload', () =>
        internalClient.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: key }),
          withinDeadline(),
        ),
      )
    },

    inspectObject: async (key) => {
      const metadata = await trace('s3.inspectObject', () =>
        internalClient.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: key }),
          withinDeadline(),
        ),
      )
      return {
        contentType: metadata.ContentType ?? null,
        sizeBytes: metadata.ContentLength ?? null,
      }
    },

    deleteObject: async (key) => {
      await trace('s3.deleteObject', () =>
        internalClient.send(
          new DeleteObjectCommand({ Bucket: bucketName, Key: key }),
          withinDeadline(),
        ),
      )
    },

    getObject: async (key, maxBytes) => {
      try {
        const response = await trace('s3.getObject', () =>
          internalClient.send(
            new GetObjectCommand({ Bucket: bucketName, Key: key }),
            withinDeadline(),
          ),
        )
        if (!response.Body) return null
        if ((response.ContentLength ?? 0) > maxBytes) {
          // Not reading it would leave the socket held by the client's pool.
          ;(response.Body as { destroy?: () => void }).destroy?.()
          throw new StoredObjectTooLargeError()
        }
        const body = await response.Body.transformToByteArray()
        if (body.length > maxBytes) throw new StoredObjectTooLargeError()
        return { body, contentType: response.ContentType ?? null }
      } catch (error) {
        if (error instanceof S3ServiceException && error.name === 'NoSuchKey') return null
        throw error
      }
    },

    putObject: async (key, body, contentType) => {
      await trace('s3.putObject', () =>
        internalClient.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
          withinDeadline(),
        ),
      )
    },
  }
}
