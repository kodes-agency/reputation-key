// Operator CLI: record the AI-analysis sequences a past leak left behind.
//
// Usage:
//   pnpm ops ai release-orphan-sequences <propertyId> --operator <id>
//     — list the orphan sequences and why they are orphans
//   pnpm ops ai release-orphan-sequences <propertyId> --operator <id> --reason <text> --apply
//
// An orphan is a sequence the allocator handed out that no Review holds, no
// event announces and nothing settled. Coverage waits for it for ever, so
// `ai.review-analysis-stalled` fires and the Property's trends stay provisional.
// The rules live in src/shared/db/review-analysis-orphan-sequences.ts and the
// invocation in src/shared/ops/ai-release-orphan-sequences-command.ts —
// scripts/ is wiring only. Requires DATABASE_URL.

import { getDb } from '../../src/shared/db'
import {
  releaseOrphanSequences,
  scanOrphanSequences,
} from '../../src/shared/db/review-analysis-orphan-sequences'
import {
  aiReleaseOrphanSequencesCommandSpec,
  planAiReleaseOrphanSequences,
  runAiReleaseOrphanSequences,
} from '../../src/shared/ops/ai-release-orphan-sequences-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    aiReleaseOrphanSequencesCommandSpec,
    async (ctx, args, io) => {
      const plan = planAiReleaseOrphanSequences(args)
      if (!plan.ok) {
        io.err(`${aiReleaseOrphanSequencesCommandSpec.name}: ${plan.error}`)
        io.err(`usage: ${aiReleaseOrphanSequencesCommandSpec.usage}`)
        return 1
      }
      const db = getDb()
      return runAiReleaseOrphanSequences({
        ctx,
        propertyId: plan.propertyId,
        store: {
          scan: (propertyId) => scanOrphanSequences(db, propertyId),
          release: (propertyId) => releaseOrphanSequences(db, propertyId),
        },
        io,
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:ai failed', err)
  process.exit(1)
})
