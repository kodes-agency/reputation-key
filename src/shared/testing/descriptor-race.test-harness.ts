// A deterministic stand-in for an attacker that wins the check-then-use race.
//
// A file-shape guard followed by a read is only safe if the object that was
// checked is the object that is read. Nothing about a FIFO, a symlink or any
// other hostile file SHAPE can demonstrate that property: a path-based
// `statSync` rejects those shapes exactly as an `fstatSync` on an open
// descriptor does. The only thing that separates the two is a REBIND of the
// path between the check and the read, and a real race is not something a test
// can schedule.
//
// `armPathSwap` schedules it. The registered rebind fires exactly once,
// immediately after the first file-shape operation the code under test performs
// on the watched path — `statSync`, `lstatSync` or `openSync`, whichever it
// reaches first. That instant is the moment the check-then-use window opens:
//
//   * check-then-use (`statSync(path)` … `readFileSync(path)`) has a real
//     window there, so it goes on to read the rebound file;
//   * open-then-check (`openSync(path)` … `fstatSync(fd)` … `readFileSync(fd)`)
//     has an empty window, because everything after the open addresses the
//     descriptor and a rebind of the NAME cannot reach it.
//
// The trigger is deliberately symmetric: it is keyed on whichever call the
// implementation makes first, not on the call the old implementation made, so
// it does not presuppose the fix. Note it fires on the path only, so an
// in-place truncation of the SAME inode is not modelled — descriptor pinning
// does not defend against that, and this harness must not pretend it does.
//
// Disarmed by default: a test file that installs the wrapper still runs every
// other test against unmodified `node:fs` behaviour.

type PathSwap = () => void

let watchedPaths: readonly string[] = []
let pendingSwap: PathSwap | undefined

/**
 * Rebind the watched file the instant the code under test first checks or opens
 * it. Several spellings of the same file are accepted because callers differ in
 * whether they resolve before checking — on macOS the temp root is itself a
 * symlink, so `/var/folders/…` and `/private/var/folders/…` name one inode and
 * a harness keyed on only one of them would silently never fire.
 */
export function armPathSwap(paths: readonly string[], swap: PathSwap): void {
  watchedPaths = [...paths]
  pendingSwap = swap
}

export function disarmPathSwap(): void {
  watchedPaths = []
  pendingSwap = undefined
}

/** Called by the `node:fs` wrapper after each path-shape operation. */
function notifyPathChecked(path: unknown): void {
  if (pendingSwap === undefined) return
  if (typeof path !== 'string' || !watchedPaths.includes(path)) return
  const swap = pendingSwap
  disarmPathSwap()
  swap()
}

type AnyPathOperation = (...args: never[]) => unknown

function afterPathCheck(operation: AnyPathOperation): AnyPathOperation {
  const passthrough = operation as (...args: unknown[]) => unknown
  return ((...args: unknown[]): unknown => {
    const result = passthrough(...args)
    notifyPathChecked(args[0])
    return result
  }) as AnyPathOperation
}

/**
 * Wrap the real `node:fs` so every path-shape operation gives an armed swap the
 * chance to run. Intended for `vi.mock('node:fs', async () =>
 * withPathSwapRace(await vi.importActual('node:fs')))`.
 *
 * Only the shape operations are wrapped. `readFileSync` deliberately is not:
 * its internal open is not routed through this module's `openSync`, so a read
 * never fires a swap and the harness cannot accidentally rearrange the very
 * step whose behaviour is under test.
 */
export function withPathSwapRace(
  actual: typeof import('node:fs'),
): typeof import('node:fs') {
  return {
    ...actual,
    statSync: afterPathCheck(actual.statSync) as unknown as typeof actual.statSync,
    lstatSync: afterPathCheck(actual.lstatSync) as unknown as typeof actual.lstatSync,
    openSync: afterPathCheck(actual.openSync) as unknown as typeof actual.openSync,
  }
}
