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

export type S3StorageConfig = Readonly<{
  accessKey?: string
  secretKey?: string
  bucketName?: string
  region?: string
  internalEndpoint?: string
  presignEndpoint?: string
  forcePathStyle?: boolean
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
    // checks it then refuses for any real file; and it frames server-side puts
    // in a checksum trailer that S3-compatible stores do not all parse.
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

  return {
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
        internalClient.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })),
      )
    },

    inspectObject: async (key) => {
      const metadata = await trace('s3.inspectObject', () =>
        internalClient.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })),
      )
      return {
        contentType: metadata.ContentType ?? null,
        sizeBytes: metadata.ContentLength ?? null,
      }
    },

    deleteObject: async (key) => {
      await trace('s3.deleteObject', () =>
        internalClient.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })),
      )
    },

    getObject: async (key, maxBytes) => {
      try {
        const response = await trace('s3.getObject', () =>
          internalClient.send(new GetObjectCommand({ Bucket: bucketName, Key: key })),
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
        ),
      )
    },
  }
}
