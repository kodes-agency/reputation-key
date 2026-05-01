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
import { getEnv } from '#/shared/config/env'

export const createS3StorageAdapter = (): StoragePort => {
  const env = getEnv()

  // If S3 is not configured, return a noop adapter
  if (
    !env.AWS_S3_ACCESS_KEY ||
    !env.AWS_S3_SECRET_ACCESS_KEY ||
    !env.AWS_S3_BUCKET_NAME ||
    !env.AWS_S3_REGION
  ) {
    return {
      createPresignedUploadUrl: async () => {
        throw new Error('S3 storage is not configured')
      },
      confirmUpload: async () => {
        throw new Error('S3 storage is not configured')
      },
      deleteObject: async () => {
        throw new Error('S3 storage is not configured')
      },
      getPublicUrl: () => '',
      putObject: async () => {
        throw new Error('S3 storage is not configured')
      },
    }
  }

  const client = new S3Client({
    region: env.AWS_S3_REGION,
    credentials: {
      accessKeyId: env.AWS_S3_ACCESS_KEY,
      secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
    },
  })

  const bucketName = env.AWS_S3_BUCKET_NAME
  const region = env.AWS_S3_REGION

  return {
    createPresignedUploadUrl: async (key, contentType, _maxSizeBytes) => {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
      })

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: 3600, // 1 hour
      })

      return { uploadUrl, key }
    },

    confirmUpload: async (key) => {
      await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
    },

    deleteObject: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
    },

    getPublicUrl: (key) => {
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
    },

    putObject: async (key, body, contentType) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },
  }
}
