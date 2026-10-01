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
  /**
   * Read an object's bytes, or null when there is no such object. An object
   * larger than `maxBytes` is an error, never a partial read. Portal media is
   * read through this and served same-origin: the bucket is private and no
   * provider URL ever reaches a browser.
   */
  getObject: (
    key: string,
    maxBytes: number,
  ) => Promise<{ body: Uint8Array; contentType: string | null } | null>
  /** Upload a buffer directly (server-side, no presigned URL). */
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>
}>
