// Portal context — R2 storage adapter
// Implements StoragePort using Cloudflare R2 (S3-compatible API).
// Uses @aws-sdk/client-s3 for R2 operations.

import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import type { StoragePort } from '../../application/ports/storage.port'
import { getEnv } from '#/shared/config/env'

export const createR2StorageAdapter = (): StoragePort => {
  const env = getEnv()

  // If R2 is not configured, return a noop adapter
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  ) {
    return {
      createPresignedUploadUrl: async () => {
        throw new Error('R2 storage is not configured')
      },
      confirmUpload: async () => {
        throw new Error('R2 storage is not configured')
      },
      deleteObject: async () => {
        throw new Error('R2 storage is not configured')
      },
      getPublicUrl: () => '',
      putObject: async () => {
        throw new Error('R2 storage is not configured')
      },
    }
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })

  const bucketName = env.R2_BUCKET_NAME
  const publicUrl = env.R2_PUBLIC_URL ?? ''

  return {
    createPresignedUploadUrl: async (key, contentType, maxSizeBytes) => {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
        ContentLength: maxSizeBytes,
      })

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: 3600, // 1 hour
      })

      return { uploadUrl, key }
    },

    confirmUpload: async (key) => {
      await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))

      if (publicUrl) {
        return `${publicUrl}/${key}`
      }
      return key
    },

    deleteObject: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
    },

    getPublicUrl: (key) => {
      return publicUrl ? `${publicUrl}/${key}` : key
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
