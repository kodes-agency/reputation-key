// Operator CLI: analyse again the reviews the automatic reopen gave up on.
//
// Usage:
//   pnpm ops ai-reopen-analyses <propertyId|all> --operator <id>
//     — list them, with the code and time of the last failure
//   pnpm ops ai-reopen-analyses <propertyId|all> --operator <id> --reason <text> --apply
//
// The rules live in the AI context's reopen adapter and the invocation in
// src/shared/ops/ai-reopen-analyses-command.ts — scripts/ is wiring only.
// Requires DATABASE_URL.

import { getDb } from '../../src/shared/db'
import {
  listSpentReviewAnalyses,
  reopenSpentReviewAnalyses,
} from '../../src/contexts/ai/infrastructure/adapters/ai-review-analysis-reopen.adapter'
import {
  aiReopenAnalysesCommandSpec,
  planAiReopenAnalyses,
  runAiReopenAnalyses,
} from '../../src/shared/ops/ai-reopen-analyses-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    aiReopenAnalysesCommandSpec,
    async (ctx, args, io) => {
      const plan = planAiReopenAnalyses(args)
      if (!plan.ok) {
        io.err(`${aiReopenAnalysesCommandSpec.name}: ${plan.error}`)
        io.err(`usage: ${aiReopenAnalysesCommandSpec.usage}`)
        return 1
      }
      const db = getDb()
      return runAiReopenAnalyses({
        ctx,
        propertyId: plan.propertyId,
        store: {
          list: (input) => listSpentReviewAnalyses(db, input),
          reopen: (input) => reopenSpentReviewAnalyses(db, input),
        },
        io,
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:ai-reopen-analyses failed', err)
  process.exit(1)
})
