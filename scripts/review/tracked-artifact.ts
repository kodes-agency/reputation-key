import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { type ArtifactClass, classifyArtifact } from './baseline-inventory'

export type TrackedArtifact = Readonly<{
  contents: Buffer
  kind: 'file' | 'symlink'
  symlinkTarget?: string
}>

export type TrackedArtifactLedgerRow = Readonly<{
  bytes: number
  class: ArtifactClass
  kind: 'file' | 'symlink'
  path: string
  sha256: string
  symlinkTarget?: string
}>

// Stat the descriptor, not the path. This function performs NO path-level
// `stat`/`lstat`/`exists` check at all: the `open` below is the first thing
// that touches `path`, and for a regular file it is the only thing — the kind,
// the size and the digest the ledger records all come from that one descriptor.
// (The symlink branch needs a second call; see the limits at the end.)
// The rejected shape is `lstatSync(path)` followed by `readFileSync(path)`,
// which measures one inode and hashes another if the path is swapped in
// between, so a ledger row could pair a size with a digest that never described
// the same object — and that ledger is the evidence a release is audited
// against. That is also why this returns the buffer instead of a stat size: the
// caller takes `bytes` from the bytes it hashed.
//
// O_NOFOLLOW is therefore the symlink DETECTOR, not a secondary guard. Opening
// a symlink with it fails with ELOOP before any content is read, which is the
// only reason the two branches below can be told apart without a prior `lstat`,
// and the only thing stopping a link from being hashed through as
// `kind: 'file'`. Every other errno propagates unchanged, so an unreadable or
// missing path fails loudly rather than producing a row.
//
// O_NONBLOCK is what keeps the open itself safe. The `isFile()` guard can only
// run AFTER the open, and a plain read-only open of a FIFO blocks until a
// writer appears, so the very swap this guards against could otherwise hang
// the freeze forever. But a FIFO opened this way then reads as EOF, so the
// guard has to REFUSE it by name: recording `bytes: 0` and the sha256 of an
// empty buffer would replace a visible hang with a silently wrong row in
// release evidence, which is the worse failure. Neither flag has any effect on
// a regular file.
//
// Two limits, stated so nobody reads more into this than it does. First,
// O_NOFOLLOW constrains ONLY the final path component: an intermediate
// directory swapped for a symlink still resolves through that link, so the
// descriptor can name a file outside `sourceRoot`. Second, the symlink branch
// cannot be made single-descriptor — Node exposes no way to read a link
// through a descriptor — so the `readlink` re-resolves the path and a link
// swapped for another link in that window records the second target. It cannot
// silently record the wrong KIND, though: if the path stops being a symlink the
// `readlink` fails with EINVAL and propagates.
//
// ELOOP as the symlink signal is a POSIX-but-not-universal detail: Linux and
// macOS both report it, some BSDs report EMLINK instead. On such a platform a
// tracked symlink throws instead of being recorded — loud, never a wrong row.
export function readTrackedArtifact(sourceRoot: string, path: string): TrackedArtifact {
  const absolute = join(sourceRoot, path)

  let descriptor: number
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ELOOP') throw error
    const symlinkTarget = readlinkSync(absolute)
    return { contents: Buffer.from(symlinkTarget), kind: 'symlink', symlinkTarget }
  }

  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`Tracked path is not a regular file: ${path}`)
    }
    return { contents: readFileSync(descriptor), kind: 'file' }
  } finally {
    closeSync(descriptor)
  }
}

// Pure by construction: the row is a projection of the buffer `readTrackedArtifact`
// already returned, and this function never touches the filesystem. That is what
// makes `bytes` and `sha256` provably describe the same bytes — a `bytes` taken
// from a stat could not be reached from here without reopening the path.
export function trackedArtifactLedgerRow(
  path: string,
  artifact: TrackedArtifact,
): TrackedArtifactLedgerRow {
  return {
    bytes: artifact.contents.byteLength,
    class: classifyArtifact(path),
    kind: artifact.kind,
    path,
    sha256: createHash('sha256').update(artifact.contents).digest('hex'),
    ...(artifact.symlinkTarget ? { symlinkTarget: artifact.symlinkTarget } : {}),
  }
}
