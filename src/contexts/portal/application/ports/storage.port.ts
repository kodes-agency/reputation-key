// Portal context — storage port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Abstracts R2/S3 storage operations for image uploads.

import type { PortalUploadIssuance } from '../../domain/upload-issuance'

export type PortalUploadDerivative = 'hero' | 'thumbnail'

export type IssuedPortalUploadStoragePort = Readonly<{
  /**
   * Portal hero capabilities accept the persisted issuance, never a caller-
   * supplied object key. Implementations re-derive and verify every key.
   */
  createIssuedPortalUpload: (
    issuance: PortalUploadIssuance,
  ) => Promise<{ uploadUrl: string }>
  confirmIssuedPortalUpload: (
    issuance: PortalUploadIssuance,
  ) => Promise<{ contentType: string | null; sizeBytes: number | null }>
  readIssuedPortalUpload: (issuance: PortalUploadIssuance) => Promise<Buffer>
  writePortalUploadDerivative: (
    issuance: PortalUploadIssuance,
    derivative: PortalUploadDerivative,
    body: Buffer,
    contentType: 'image/webp',
  ) => Promise<{ objectKey: string; publicUrl: string }>
  deleteIssuedPortalUpload: (issuance: PortalUploadIssuance) => Promise<void>
}>

/**
 * Legacy Guest/Identity media operations. Guest media is dark for beta and
 * owns a separate issuance row. Portal hero code must depend on
 * `IssuedPortalUploadStoragePort`, never on these arbitrary-key primitives.
 */
export type StoragePort = Readonly<{
  createPresignedUploadUrl: (
    key: string,
    contentType: string,
    maxSizeBytes: number,
  ) => Promise<{ uploadUrl: string; key: string }>
  confirmUpload: (key: string) => Promise<string>
  /** Read server-observed metadata before accepting a guest-owned upload. */
  inspectObject?: (
    key: string,
  ) => Promise<{ contentType: string | null; sizeBytes: number | null }>
  deleteObject: (key: string) => Promise<void>
  /** Return the public URL for a given key. */
  getPublicUrl: (key: string) => string
  /** Upload a buffer directly (server-side, no presigned URL). */
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>
}>

/** Production S3 implements both independently consumed capability surfaces. */
export type PortalStoragePort = StoragePort & IssuedPortalUploadStoragePort
