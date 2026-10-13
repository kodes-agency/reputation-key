// Whether a gate module is the script the process was started with.
//
// A gate runs its `main` only then, so its test can import it without running
// it. The guard has no `else`, so a comparison that is wrongly false makes the
// gate print nothing and exit 0. Comparing `import.meta.url` with
// `process.argv[1]` as text is wrong in two ordinary cases: Node resolves the
// entry module to its real path and percent-encodes the address, and does
// neither to `process.argv[1]`. A checkout reached through a symbolic link
// (macOS `/tmp`), or kept under a directory with a space in its name, passed
// every gate without running one. Real paths are compared instead, and a
// started script that is not a file throws rather than answer "not me".

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function realScriptPath(path: string): string {
  try {
    return realpathSync(path)
  } catch (cause) {
    throw new Error(
      `${path} is not a file, so this script cannot tell whether it was started directly`,
      { cause },
    )
  }
}

/** True when `moduleUrl` (the caller's `import.meta.url`) is the started script. */
export function isEntryPoint(
  moduleUrl: string,
  startedScript: string | undefined = process.argv[1],
): boolean {
  if (startedScript === undefined) return false
  return realScriptPath(startedScript) === realScriptPath(fileURLToPath(moduleUrl))
}
