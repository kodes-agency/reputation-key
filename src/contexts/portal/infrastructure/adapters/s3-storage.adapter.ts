// Portal context — S3 storage adapter
// Implements StoragePort using AWS S3.
// Uses @aws-sdk/client-s3 for S3 operations.

import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StoragePort } from '../../application/ports/storage.port'
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
      getPublicUrl: () => '',
      putObject: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
    }
  }

  const clients = buildS3ClientConfigs(config as ConfiguredS3Storage)
  const internalClient = new S3Client(clients.internal)
  const presignClient = new S3Client(clients.presign)
  const bucketName = config.bucketName
  const region = config.region

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
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
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

    getPublicUrl: (key) => {
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
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
