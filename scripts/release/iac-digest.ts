// Shared IaC source digest.
//
// REG-02 plan evidence and the REG-03 promotion manifest must report the SAME
// digest for the same `.railway` tree, otherwise a reviewed plan cannot be
// correlated with the release that was promoted from it. Keeping one
// implementation here removes the chance of the two drifting apart silently.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function sourceFileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Digest of every file under the given roots, keyed by cwd-relative path and
 * sorted so the result is independent of directory iteration order.
 */
export function sourceTreeDigest(paths: readonly string[]): string {
  const entries = paths
    .flatMap((path) => {
      const absolute = resolve(path)
      return readdirSync(absolute, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = join(entry.parentPath, entry.name)
          return {
            path: filePath.slice(process.cwd().length + 1),
            sha256: sourceFileSha256(filePath),
          }
        })
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return createHash('sha256')
    .update(`${JSON.stringify(entries)}\n`)
    .digest('hex')
}
