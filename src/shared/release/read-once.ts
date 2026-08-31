// Reviewed-artifact reads, without a stat-then-read race.
//
// The read-side twin of `write-once.ts`. Every release consumer must refuse an
// artifact that is not a regular file, and the obvious shape —
//
//   const stat = lstatSync(path)
//   if (!stat.isFile() || stat.isSymbolicLink()) return refuse()
//   const bytes = readFileSync(path)
//
// is two operations on two separate resolutions of an operator-supplied path.
// The inode that satisfied the guard need not be the inode whose bytes come
// back, and those bytes are what these commands hash into the digest an
// operator reviewed, or hand to a signature verifier. Opening once and
// validating the OPEN DESCRIPTOR makes the checked object and the read object
// the same object by construction. One resolution, no window.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs'

/**
 * Preserve the refusal the old `lstatSync` guard produced for a path that
 * cannot be opened at all.
 *
 * `O_NOFOLLOW` reports a symlink as `ELOOP`, and a socket reports `ENXIO` on
 * Linux and an unnamed errno on darwin, so re-throwing the raw open error would
 * swap a clear operator-facing refusal for a bare errno on exactly the inputs
 * the guard exists to catch.
 *
 * Resolving the path a second time HERE is not the race this module closes:
 * this branch holds no descriptor, returns no bytes, and can only choose which
 * message describes a path that was already refused. It cannot decide which
 * bytes are hashed. A missing path still raises its original `ENOENT`, and a
 * regular file that merely could not be opened (`EACCES`, `EMFILE`) still
 * raises its own error rather than being mislabelled as non-regular.
 */
function unopenablePathRefusal(
  path: string,
  refusal: string,
  error: unknown,
): Error | undefined {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') return undefined
  let entry
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): the path is an operator CLI argument in a release consumer, never request input; a literal path is impossible for a helper whose whole purpose is reading the caller's artifact
    entry = lstatSync(path)
  } catch {
    return undefined
  }
  return entry.isFile() ? undefined : new Error(refusal, { cause: error })
}

/**
 * Read a reviewed release artifact through a single path resolution, refusing
 * anything that is not a regular file with the caller's `refusal` message.
 *
 * SCOPE, precisely. This closes the stat/read window on the FINAL path
 * component and nothing more. `O_NOFOLLOW` refuses a symlink at that component
 * exactly as `lstatSync().isSymbolicLink()` did and, exactly like `lstatSync`,
 * says nothing about the intermediate directories: one of those swapped for a
 * symlink still resolves wherever it points. This is not a containment check,
 * and it does not by itself close the alert family for paths whose parent
 * directories an attacker controls.
 *
 * `O_NONBLOCK` is what makes taking the descriptor safe. The `isFile()` guard
 * can only run AFTER the open, and a plain `O_RDONLY` open of a FIFO blocks
 * until a writer appears, so a swapped path could hang the command forever
 * where the old path-stat refused it immediately. The guard stays load-bearing
 * in its own right: a FIFO opened non-blocking reads as EOF rather than
 * blocking, so dropping the guard does not reinstate the hang — it substitutes
 * an empty buffer for the reviewed artifact, which callers then reject one step
 * later as invalid JSON. That is a refusal for the wrong reason; only the guard
 * refuses the path itself.
 *
 * `maxBytes` is checked on the descriptor, and callers that pass it must still
 * bound the returned buffer: the size is the one property the descriptor does
 * not pin, because the same inode can be appended to between `fstat` and read.
 */
export function readOnce(path: string, refusal: string, maxBytes?: number): Buffer {
  let descriptor: number
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): the path is an operator CLI argument in a release consumer, never request input; a literal path is impossible for a helper whose whole purpose is reading the caller's artifact
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (error) {
    const refused = unopenablePathRefusal(path, refusal, error)
    if (refused) throw refused
    throw error
  }
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(refusal)
    if (maxBytes !== undefined && stat.size > maxBytes) throw new Error(refusal)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): the path is an operator CLI argument in a release consumer, never request input; a literal path is impossible for a helper whose whole purpose is reading the caller's artifact
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
