// Portal context — storage port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Abstracts R2/S3 storage operations for image uploads.

export type StoragePort = Readonly<{
  createPresignedUploadUrl: (
    key: string,
    contentType: string,
    maxSizeBytes: number,
  ) => Promise<{ uploadUrl: string; key: string }>
  confirmUpload: (key: string) => Promise<string>
  deleteObject: (key: string) => Promise<void>
  /** Return the public URL for a given key. */
  getPublicUrl: (key: string) => string
  /** Upload a buffer directly (server-side, no presigned URL). */
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>
}>
