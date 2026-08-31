import { realpathSync, renameSync, writeFileSync } from 'node:fs'
import { armPathSwap } from './descriptor-race.test-harness'

// Deliberately a SEPARATE module from descriptor-race.test-harness: that one is
// pulled in by the `vi.mock('node:fs', …)` factory itself, so it must never
// import `node:fs` or the factory would re-enter while it is still running.
// This module is imported only by test bodies, long after the mock is in place.

/**
 * Arm an atomic rebind of `path` to a fresh inode holding `decoy`, fired the
 * instant the code under test first checks or opens that path.
 *
 * A rename rather than a truncating write, so the ORIGINAL inode survives: a
 * descriptor already open on it keeps yielding the original bytes, while
 * anything that re-resolves the NAME after the check yields the decoy. That
 * difference is the entire behavioural gap between a path-based file-shape
 * guard and one that guards the open descriptor.
 *
 * Both the caller's spelling and its resolved form are watched: some readers
 * check the path they were handed, others check the `realpathSync` form, and on
 * macOS the temp root is a symlink so those two strings differ.
 */
export function armRebindOnFirstCheck(path: string, decoy: string): void {
  const realPath = realpathSync(path)
  armPathSwap([path, realPath], () => {
    const staging = `${realPath}.decoy`
    writeFileSync(staging, decoy)
    renameSync(staging, realPath)
  })
}
