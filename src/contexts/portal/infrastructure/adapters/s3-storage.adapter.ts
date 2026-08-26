// Portal context — S3 storage adapter
// Implements StoragePort using AWS S3.
// Uses @aws-sdk/client-s3 for S3 operations.

import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  PortalUploadDerivative,
  PortalStoragePort,
} from '../../application/ports/storage.port'
import { portalError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
import {
  expectedPortalHeroSourceObjectKey,
  type PortalUploadIssuance,
} from '../../domain/upload-issuance'

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

export function portalDerivativeObjectKey(
  issuance: PortalUploadIssuance,
  derivative: PortalUploadDerivative,
): string {
  return `public/portal-heroes/${issuance.id}/${derivative}.webp`
}

function assertIssuedPortalObject(issuance: PortalUploadIssuance): void {
  if (issuance.objectKey !== expectedPortalHeroSourceObjectKey(issuance)) {
    throw portalError('upload_failed', 'Portal upload object key is invalid')
  }
}

export const createS3StorageAdapter = (config: S3StorageConfig): PortalStoragePort => {
  // If S3 is not configured, return a noop adapter
  if (!config.accessKey || !config.secretKey || !config.bucketName || !config.region) {
    return {
      createIssuedPortalUpload: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      confirmIssuedPortalUpload: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      readIssuedPortalUpload: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      writePortalUploadDerivative: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      deleteIssuedPortalUpload: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
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
    createIssuedPortalUpload: async (issuance) => {
      assertIssuedPortalObject(issuance)
      if (issuance.state !== 'issued') {
        throw portalError('upload_failed', 'Portal upload is not issuable')
      }
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: issuance.objectKey,
        ContentType: issuance.contentType,
      })
      const ttlSeconds = Math.max(
        1,
        Math.min(
          15 * 60,
          Math.floor((issuance.expiresAt.getTime() - issuance.issuedAt.getTime()) / 1000),
        ),
      )
      const uploadUrl = await trace('s3.createIssuedPortalUpload', () =>
        getSignedUrl(presignClient, command, { expiresIn: ttlSeconds }),
      )
      return { uploadUrl }
    },

    confirmIssuedPortalUpload: async (issuance) => {
      assertIssuedPortalObject(issuance)
      const metadata = await trace('s3.confirmIssuedPortalUpload', () =>
        internalClient.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: issuance.objectKey }),
        ),
      )
      return {
        contentType: metadata.ContentType ?? null,
        sizeBytes: metadata.ContentLength ?? null,
      }
    },

    readIssuedPortalUpload: async (issuance) => {
      assertIssuedPortalObject(issuance)
      if (issuance.state !== 'consumed') {
        throw portalError('upload_failed', 'Portal upload is not processable')
      }
      const object = await trace('s3.readIssuedPortalUpload', () =>
        internalClient.send(
          new GetObjectCommand({ Bucket: bucketName, Key: issuance.objectKey }),
        ),
      )
      if (
        object.ContentType !== issuance.contentType ||
        object.ContentLength !== issuance.declaredSizeBytes ||
        object.ContentLength > issuance.maxSizeBytes ||
        !object.Body
      ) {
        throw portalError('upload_failed', 'Portal upload metadata changed')
      }
      const bytes = await object.Body.transformToByteArray()
      if (
        bytes.byteLength !== issuance.declaredSizeBytes ||
        bytes.byteLength > issuance.maxSizeBytes
      ) {
        throw portalError('upload_failed', 'Portal upload size changed')
      }
      return Buffer.from(bytes)
    },

    writePortalUploadDerivative: async (issuance, derivative, body, contentType) => {
      assertIssuedPortalObject(issuance)
      if (issuance.state !== 'consumed') {
        throw portalError('upload_failed', 'Portal upload is not processable')
      }
      const objectKey = portalDerivativeObjectKey(issuance, derivative)
      if (objectKey === issuance.objectKey) {
        throw portalError('upload_failed', 'Derivative must not overwrite its source')
      }
      await trace('s3.writePortalUploadDerivative', () =>
        internalClient.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
            Body: body,
            ContentType: contentType,
          }),
        ),
      )
      return {
        objectKey,
        publicUrl: `https://${bucketName}.s3.${region}.amazonaws.com/${objectKey}`,
      }
    },

    deleteIssuedPortalUpload: async (issuance) => {
      assertIssuedPortalObject(issuance)
      await trace('s3.deleteIssuedPortalUpload', () =>
        internalClient.send(
          new DeleteObjectCommand({ Bucket: bucketName, Key: issuance.objectKey }),
        ),
      )
    },

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
