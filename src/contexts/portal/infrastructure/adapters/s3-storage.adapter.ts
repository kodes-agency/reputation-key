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

export const createS3StorageAdapter = (config: {
  accessKey?: string
  secretKey?: string
  bucketName?: string
  region?: string
}): StoragePort => {
  // If S3 is not configured, return a noop adapter
  if (!config.accessKey || !config.secretKey || !config.bucketName || !config.region) {
    return {
      createPresignedUploadUrl: async () => {
        throw portalError('upload_failed', 'S3 storage is not configured')
      },
      confirmUpload: async () => {
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

  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  })

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
        getSignedUrl(client, command, {
          expiresIn: 3600, // 1 hour
        }),
      )

      return { uploadUrl, key }
    },

    confirmUpload: async (key) => {
      await trace('s3.confirmUpload', () =>
        client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })),
      )
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
    },

    deleteObject: async (key) => {
      await trace('s3.deleteObject', () =>
        client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })),
      )
    },

    getPublicUrl: (key) => {
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
    },

    putObject: async (key, body, contentType) => {
      await trace('s3.putObject', () =>
        client.send(
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
