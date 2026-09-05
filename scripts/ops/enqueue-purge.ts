// Operator CLI (BQC-7.5): bounded re-run of a purge/retention sweep by
// ENQUEUEING the job through the BQC-3 producer contract (createJobQueue +
// jobEnqueueOptions — catalogue retry policy; the dispatch gate re-authorizes
// at execution). Handlers are never invoked directly.
//
// DESTRUCTIVE: retention deletes expired data (bounded, evidence-writing), so
// --apply requires the typed confirmation --yes ops:purge. Review targets run
// the content-free report/shadow authority only; even an enqueued invocation
// has no destructive apply authority until the reviewed REV-01 cutover.
//
// Usage:
//   pnpm ops:purge <target> --operator <id>            — dry-run report
//   pnpm ops:purge <target> --operator <id> --reason <text> --apply --yes ops:purge
//
// Targets (background queue, bounded internally by the sweeps themselves):
//   reviews         — checkpointed lifecycle eligibility report (no mutation)
//   reviews-shadow  — checkpointed expand/cache parity report (no mutation)
//   retention  — retention-sweep (daily; static registry, evidence in retention_runs)
//
// Report mode requires DATABASE_URL only. Apply also requires QUEUE_REDIS_URL. Every
// invocation is audited by the harness; an enqueued apply is re-authorized by
// the BQC-3 dispatch gate at execution.
// Runbook §10: purge requires operator confirmation + evidence report.

import { createJobQueue } from '../../src/shared/jobs/queue'
import { jobEnqueueOptions } from '../../src/shared/jobs/job-policy'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { getDb } from '../../src/shared/db'
import {
  GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT,
  RETENTION_RULES,
} from '../../src/shared/jobs/retention-sweep.job'
import { buildRetentionRuleReport } from '../../src/shared/db/retention/report-retention-rules'
import { wireReviewSourceContentLifecycle } from '../../src/contexts/review/build'
import { runOperatorCommand } from './operator-command'

const TARGETS = {
  reviews: {
    jobName: 'purge-expired-reviews',
    capability: 'review.use',
    lifecycleMode: 'report',
  },
  'reviews-shadow': {
    jobName: 'purge-expired-reviews',
    capability: 'review.use',
    lifecycleMode: 'shadow',
  },
  // Retention is the data-lifecycle safety process — deliberately NOT
  // capability-gated so it still runs while product capabilities are killed.
  retention: {
    jobName: 'retention-sweep',
    capability: undefined,
    lifecycleMode: undefined,
  },
} as const

type Target = keyof typeof TARGETS

const USAGE = `pnpm ops:purge <${Object.keys(TARGETS).join('|')}> --operator <id> [--reason <text> --apply --yes ops:purge]`

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [target] = positionalArgs(process.argv.slice(2))
  if (!target || !(target in TARGETS)) usage()
  const { jobName, capability, lifecycleMode } = TARGETS[target as Target]

  const result = await runOperatorCommand(
    {
      name: 'ops:purge',
      scope: 'global',
      mutation: true,
      destructive: true,
      capability,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      if (ctx.dryRun) {
        if (target === 'retention') {
          const report = await buildRetentionRuleReport({
            db: getDb(),
            rules: RETENTION_RULES,
            generatedAt: new Date(),
          })
          io.out(
            JSON.stringify(
              {
                target,
                coverage: 'static_rule_registry',
                separatelyInspectedSubjects: [GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT],
                ...report,
              },
              null,
              2,
            ),
          )
          io.out(
            'report is content-free and read-only; re-run with --apply --yes ops:purge to enqueue the bounded apply',
          )
          io.out(
            'Google import lifecycle backlog is no longer reported: the compatibility surface was deleted with its five tables.',
          )
          return
        }
        const runLifecycle = wireReviewSourceContentLifecycle({
          db: getDb(),
          clock: () => new Date(),
        })
        const report = await runLifecycle({
          mode: lifecycleMode ?? 'report',
          batchSize: 100,
        })
        io.out(JSON.stringify({ target, ...report }, null, 2))
        io.out(
          'report is content-free and read-only; destructive apply remains unavailable pending external shadow parity and cutover approval',
        )
        return
      }

      const queue = createJobQueue('background')
      if (!queue) {
        io.err('QUEUE_REDIS_URL is not configured — cannot reach the background queue.')
        return 1
      }
      try {
        const job = await queue.add(
          jobName,
          lifecycleMode == null ? {} : { mode: lifecycleMode },
          jobEnqueueOptions(jobName),
        )
        io.out(
          JSON.stringify(
            { enqueued: jobName, queue: 'background', jobId: job.id, target },
            null,
            2,
          ),
        )
        io.out(
          'evidence: sweep results land in retention_runs / the job log — attach to the ticket',
        )
      } finally {
        await queue.close()
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:purge failed', err)
  process.exit(1)
})
