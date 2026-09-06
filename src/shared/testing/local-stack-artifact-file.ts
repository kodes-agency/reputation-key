import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'

// Stat the descriptor, not the path. The local stack controller used to check a
// path with `existsSync` and then read it, which inspects one inode and reads
// another if the path is swapped in between — the artifact root holds generated
// Ed25519, HMAC and TLS private-key material, so that swap hands the stack key
// the inspected object and the read object the same object by construction.
//
// O_NONBLOCK is what keeps that safe: the `isFile()` guard can only run AFTER
// the open, and a plain read-only open of a FIFO blocks until a writer appears,
// so the very swap this guards against could otherwise hang the stack script
// forever. With O_NONBLOCK the open returns immediately and `fstat` reports the
// FIFO. The `isFile()` guard then has to reject it explicitly: a non-blocking
// read of a writer-less FIFO yields EOF, so without the guard the caller would
// record an empty key, a zero-length base64 env value or the sha256 of an empty
// buffer as if it were legitimate — a silent wrong answer in place of a loud
// hang, which is worse.
//
// O_NOFOLLOW refuses a symlink at the FINAL path component only. It does NOT
// make the whole path race-free: an intermediate directory replaced by a symlink
// still resolves somewhere else, and this function has no way to notice. Closing
// that would need an openat(2) walk from a directory descriptor, which Node does
// not expose.
//
// Do not read that residual risk as bounded by directory permissions — it is
// not. `prepare()` in scripts/local-stack/stack.ts chmods the artifact trees
// world-writable so the bind-mounted containers (uid 1000) can write them:
// measured under umask 022, `.local-stack/<mode>/e2e` is 0o777 with no sticky
// bit, and test-results/local-stack/<mode> and its perf/ child are 0o777 too.
// The only 0o700 directories are google-runtime and ai-runtime, and they are
// CHILDREN of that 0o777 e2e directory, so any local account can rename one
// aside and drop a symlink in its place — the intermediate-directory swap
// above, reachable without ever entering a 0o700 directory. Other callers touch
// no 0o700 path at all: the acceptance JSON reads are 0o755, COMPOSE_FILE is an
// ordinary working-tree file, and the operator's --pre-cutover-dump path is
// arbitrary and opts out of O_NOFOLLOW outright.
//
// So the guarantee here is narrow and worth stating exactly: the inode that is
// inspected is the inode that is read, and a FIFO, directory or final-component
// symlink is refused loudly instead of being read as empty. That is a
// correctness and fail-loud property for a development and CI harness. It is
// not a control that holds against an untrusted local user on a shared host.
//
// POSIX-only. O_NONBLOCK and O_NOFOLLOW do not exist in Node's fs.constants on
// Windows, and `undefined` in a bitwise OR coerces to 0 rather than to NaN — so
// the flags would NOT fail loudly there, they would silently collapse to a
// plain O_RDONLY and drop both guards. The explicit check below refuses to run
// in that configuration rather than degrade quietly.
export function readLocalStackFile(
  path: string,
  options: Readonly<{ allowSymlink?: boolean }> = {},
): Buffer {
  if (
    typeof constants.O_NONBLOCK !== 'number' ||
    typeof constants.O_NOFOLLOW !== 'number'
  ) {
    throw new Error(
      `Local stack artifact reads require POSIX O_NONBLOCK and O_NOFOLLOW, which ${process.platform} does not provide`,
    )
  }
  const symlinkFlag = options.allowSymlink === true ? 0 : constants.O_NOFOLLOW
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | symlinkFlag,
  )
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`Local stack path is not a regular file: ${path}`)
    }
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

// Callers that generate the file when it is absent used to ask the path twice —
// `existsSync(path)` and then `readFileSync(path)` — which is the exact
// check-then-use pair this module exists to remove. Asking the open itself keeps
// it to one syscall on one inode. Only ENOENT is absorbed: a symlink still fails
// the O_NOFOLLOW open with ELOOP, and a directory or a FIFO still fails the
// `isFile()` guard, so an unexpected object at that path is never mistaken for
// "not generated yet" and silently overwritten.
export function readOptionalLocalStackFile(path: string): Buffer | null {
  try {
    return readLocalStackFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
