// Portal context — arbitrary-key object storage used by live profile assets.
// Per architecture: ports are TypeScript types defining capability contracts.

/** `getObject` found an object larger than the cap it was given. */
export class StoredObjectTooLargeError extends Error {
  constructor() {
    super('The stored object is larger than allowed')
    this.name = 'StoredObjectTooLargeError'
  }
}

export type StoragePort = Readonly<{
  createPresignedUploadUrl: (
    key: string,
    contentType: string,
    maxSizeBytes: number,
  ) => Promise<{ uploadUrl: string; key: string }>
  /**
   * Resolve when the object is in the store, reject when it is not. It hands
   * back no address: the bucket is private, so no provider URL is ever stored
   * or shown; an image is served through the app (see Identity's asset route).
   */
  confirmUpload: (key: string) => Promise<void>
  /** Read server-observed metadata before accepting a guest-owned upload. */
  inspectObject?: (
    key: string,
  ) => Promise<{ contentType: string | null; sizeBytes: number | null }>
  deleteObject: (key: string) => Promise<void>
  /**
   * Read an object's bytes, or null when there is no such object. An object
   * larger than `maxBytes` is a `StoredObjectTooLargeError`, never a partial read. Portal media is
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
