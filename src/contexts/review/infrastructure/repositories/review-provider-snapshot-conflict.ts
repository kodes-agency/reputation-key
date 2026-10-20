// What a snapshot page commit throws when the page cannot be recorded, and the
// failure the run asks for because of it.
//
// The code is a failure code, or `page_overlap` for a review that closes one
// main-scan page and opens the next (application/snapshot-listing-change.ts):
// the store records the run's failure from it, quietly as `listing_changed`
// while a listing that moves under the run is rare.

import type { SnapshotFailureRequest } from '../../application/snapshot-listing-change'

export class SnapshotConflict extends Error {
  readonly code: SnapshotFailureRequest

  constructor(code: SnapshotFailureRequest) {
    super(code)
    this.code = code
  }
}

/** The failure a thrown error asks for: its own code for a conflict, a
 * resource collision for anything the commit did not expect. */
export function failCode(error: unknown): SnapshotFailureRequest {
  if (error instanceof SnapshotConflict) return error.code
  return 'resource_collision'
}
