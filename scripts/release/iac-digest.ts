// Shared IaC source digest.
//
// REG-02 plan evidence and the REG-03 promotion manifest must report the SAME
// digest for the same Railway IaC source set, otherwise a reviewed plan cannot be
// correlated with the release that was promoted from it. Keeping one
// implementation here removes the chance of the two drifting apart silently.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Every source that can change the Railway graph or its target-isolation guard. */
export const RAILWAY_IAC_SOURCE_PATHS = Object.freeze([
  '.railway',
  'src/shared/domain/data-cell-catalogue.ts',
  'src/shared/release/railway-deployment-profile.ts',
  'src/shared/release/railway-project-service-isolation.ts',
] as const)

export function sourceFileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Digest of every named file and every file under named directories, keyed by
 * cwd-relative path and sorted so directory iteration order cannot affect it.
 */
export function sourceTreeDigest(paths: readonly string[], root = process.cwd()): string {
  const entries = paths
    .flatMap((path) => {
      const absolute = resolve(root, path)
      if (statSync(absolute).isFile()) {
        return [
          {
            path: relative(root, absolute),
            sha256: sourceFileSha256(absolute),
          },
        ]
      }
      return readdirSync(absolute, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = join(entry.parentPath, entry.name)
          return {
            path: relative(root, filePath),
            sha256: sourceFileSha256(filePath),
          }
        })
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return createHash('sha256')
    .update(`${JSON.stringify(entries)}\n`)
    .digest('hex')
}

export function railwayIacSourceDigest(): string {
  return sourceTreeDigest(RAILWAY_IAC_SOURCE_PATHS)
}
