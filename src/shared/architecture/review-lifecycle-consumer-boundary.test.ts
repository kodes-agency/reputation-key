import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Review source-content lifecycle consumer boundary', () => {
  it('keeps operational consumers on the checkpointed application authority', () => {
    const consumers = ['scripts/ops/restore-verify.ts', 'scripts/perf/load-test.ts'].map(
      read,
    )

    for (const source of consumers) {
      expect(source).not.toContain('reviewRepo.countExpiredBeforeAcrossTenants')
      expect(source).not.toContain('reviewRepo.findExpiredBatchBeforeAcrossTenants')
    }
  })

  it('does not present the quarantined compatibility job as destructive evidence', () => {
    const perfHarness = read('scripts/perf/load-test.ts')
    const catalogue = read('src/shared/governance/event-job-catalogue.ts')

    expect(perfHarness).not.toContain(
      "queue.add(\n                'purge-expired-reviews'",
    )
    expect(catalogue).not.toContain(
      'atomic review delete + outbox write via ReplyCommandStore.purgeExpiredReview',
    )
  })
})
