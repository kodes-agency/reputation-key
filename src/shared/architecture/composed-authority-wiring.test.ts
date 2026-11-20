// Wiring that the type checker cannot see: the parameters are optional or the
// value is a scope string, so a call that drops them still compiles.
//
// Operator scripts build their own stores outside the container. Each must hand
// the Reputation writer to every store or recovery call that can end Replies.
//
// The Review Analysis consumer's catalogue row is ungated so a review can be
// queued; what keeps it from analysing a stopped Organization's review on
// delivery is the policy question it is handed, so the worker's composition
// must hand it the drain's own.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('Reply scope effects at each operator script', () => {
  it.each([
    [
      'scripts/ops/ai-execution-control.ts',
      /createAiControlAdapter\(\s*db,\s*reputationReplyScopeEffects/,
    ],
    [
      'scripts/ops/restore-verify.ts',
      /applyRecoveryFence\([^)]*reputationReplyScopeEffects/s,
    ],
    ['scripts/ops/enqueue-purge.ts', /replyEffects:\s*reputationReplyScopeEffects/],
  ])('%s passes the writer where it builds the call', (path, handsOver) => {
    expect(read(path)).toMatch(handsOver)
  })
})

describe('Review Analysis delivery under platform policy', () => {
  it('is given the scope authorizer of the drain where the worker is composed', () => {
    expect(read('src/composition/ai-wiring.ts')).toMatch(
      /authorizeReviewAnalysisScope: createScheduledScopeAuthorizer\(\s*'system:ai\.review_analysis_backlog_drain',?\s*\)/u,
    )
    expect(read('src/contexts/ai/build.ts')).toMatch(
      /authorizeScope: input\.authorizeReviewAnalysisScope,/u,
    )
  })
})
