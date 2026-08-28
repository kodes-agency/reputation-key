// Write-once artifact creation, without a check-then-write race.
//
// Every release producer must refuse to overwrite an artifact: an evidence file
// that can be rewritten is not evidence. The obvious shape —
//
//   if (existsSync(path)) return refuse()
//   writeFileSync(path, content, { flag: 'wx' })
//
// is two operations where one will do. Between the check and the write the file
// can appear, so the check proves nothing the `wx` flag does not already prove
// atomically, and it is exactly the time-of-check/time-of-use pattern static
// analysis flags. The pre-check only ever bought a nicer error message.
//
// So the flag is the whole mechanism, and EEXIST is translated into that same
// message. One code path, no window.

import { writeFileSync } from 'node:fs'

export type WriteOnceOutcome =
  | Readonly<{ status: 'written' }>
  | Readonly<{ status: 'already_present' }>
  | Readonly<{ status: 'failed'; message: string }>

function isAlreadyPresent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

/**
 * Create `path` with `content`, never replacing an existing file.
 *
 * @returns `already_present` when the path already existed — the caller decides
 *   whether that is success (a content-addressed file whose name IS its digest)
 *   or a refusal (a named artifact that must be produced exactly once).
 */
export function writeOnce(path: string, content: string): WriteOnceOutcome {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): the path is an operator CLI argument in a release producer, never request input; a literal path is impossible for a helper whose whole purpose is writing the caller's artifact
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
    return { status: 'written' }
  } catch (error) {
    if (isAlreadyPresent(error)) return { status: 'already_present' }
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Create a content-addressed sibling whose filename is its own digest.
 *
 * An existing file is success rather than a refusal: the name is the content,
 * so a second producer writing the same bytes has nothing to disagree about.
 */
export function writeContentAddressed(path: string, content: string): WriteOnceOutcome {
  const outcome = writeOnce(path, content)
  return outcome.status === 'already_present' ? { status: 'written' } : outcome
}
