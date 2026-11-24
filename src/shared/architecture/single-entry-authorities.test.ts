// Writes that must go through one named entry point. A runtime test sees only
// the paths it exercises; these scans see every caller that exists.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

const productionFiles = (directory: string, pattern = /\.tsx?$/u) =>
  walk(join(ROOT, directory))
    .filter((file) => pattern.test(file) && !/\.(?:test|spec)\.tsx?$/u.test(file))
    .sort()

const callersOf = (files: readonly string[], spelling: RegExp | string) =>
  files
    .filter((file) => {
      const source = readFileSync(file, 'utf8')
      return typeof spelling === 'string'
        ? source.includes(spelling)
        : spelling.test(source)
    })
    .map((file) => relative(ROOT, file))

describe('Portal page-edit ledger', () => {
  // Every working-copy change opens a pending-change fence AND writes a
  // page-edit ledger row. `recordPortalContentChange` does both, so a write that
  // opened the fence directly would leave the History without who made it.
  it('lets only recordPortalContentChange open a pending-change fence', () => {
    expect(
      callersOf(productionFiles('src'), /\brecordPortalPendingContentChange\b/u),
    ).toEqual([
      'src/contexts/portal/publication/portal-page-edits.server.ts',
      'src/contexts/portal/publication/portal-pending-content-changes.server.ts',
    ])
  })
})

describe('Portal Organization Export contributor', () => {
  it('stays composition input: no Portal server function, route or build reaches it', () => {
    const reachable = productionFiles('src/contexts/portal', /\.ts$/u)
      .filter((path) => !path.endsWith('build.ts') && !path.includes('/adapters/'))
      .filter((path) => readFileSync(path, 'utf8').includes('organizationExport'))
      .map((path) => relative(ROOT, path))
    expect(reachable).toEqual([])

    expect(
      callersOf(productionFiles('src/routes'), 'organizationExportContributor'),
    ).toEqual([])

    // Built by the rights executor, never by a build.
    expect(
      readFileSync(join(ROOT, 'src/contexts/portal/build.ts'), 'utf8'),
    ).not.toContain('createPortalOrganizationExportContributor')
  })
})

describe('Review lifecycle authority', () => {
  it('permits storage apply only through the checkpointed application authority', () => {
    expect(
      callersOf(
        productionFiles('src/contexts/reputation', /\.ts$/u),
        '.applyLifecycleBatch(',
      ),
    ).toEqual(['src/contexts/reputation/content/run-source-content-lifecycle.server.ts'])
  })

  it('keeps Review purge/report jobs and operator adapters free of direct Review deletion', () => {
    const entryPoints = [
      'src/contexts/reputation/content/purge-expired-reviews-job.server.ts',
      'src/contexts/reputation/content/review-provider-lifecycle-sweeps-job.server.ts',
      'scripts/ops/enqueue-purge.ts',
      'scripts/ops/restore-verify.ts',
    ] as const
    const directDeletion = /(?:delete\s+from\s+["`]?reviews|\.delete\(reviews\))/iu

    expect(directDeletion.test('await tx.delete(reviews)')).toBe(true)
    expect(
      entryPoints.filter((file) =>
        directDeletion.test(readFileSync(join(ROOT, file), 'utf8')),
      ),
    ).toEqual([])
  })
})
