import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE,
  isLegacyDestructiveReviewLifecycleEnabled,
} from './review-lifecycle-safety'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'src/contexts/review')

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypescriptFiles(path)
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.spec.ts')
    ) {
      return []
    }
    return [path]
  })
}

describe('Review lifecycle safety cutover', () => {
  it('keeps legacy destructive schedules disabled behind an explicit release condition', () => {
    expect(isLegacyDestructiveReviewLifecycleEnabled()).toBe(false)
    expect(REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE).toEqual(
      expect.objectContaining({
        owner: 'review-context',
        releaseDecision: 'explicit-reviewed-cutover',
      }),
    )
    expect(REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.releaseCondition).toContain(
      'external zero-difference shadow window',
    )
  })

  it('permits storage apply only through the checkpointed application authority', () => {
    const callers = productionTypescriptFiles(REVIEW_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes('.applyLifecycleBatch('))
      .map((file) => relative(ROOT, file))

    expect(callers).toEqual([
      'src/contexts/review/application/use-cases/run-source-content-lifecycle.ts',
    ])
  })

  it('keeps Review purge/report jobs and operator adapters free of direct Review deletion', () => {
    const entryPoints = [
      'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
      'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
      'src/contexts/review/infrastructure/source-content-purge.ts',
      'scripts/ops/enqueue-purge.ts',
      'scripts/ops/restore-verify.ts',
    ] as const
    const directDeletion = /(?:delete\s+from\s+["`]?reviews|\.delete\(reviews\))/iu

    expect(
      entryPoints.filter((file) =>
        directDeletion.test(readFileSync(join(ROOT, file), 'utf8')),
      ),
    ).toEqual([])
  })
})
