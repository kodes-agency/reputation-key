// Portal context — arbitrary-key object storage used by live profile assets.
// Per architecture: ports are TypeScript types defining capability contracts.

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

