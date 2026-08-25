// Operator CLI (BQC-7.5): bounded re-run of a purge/retention sweep by
// ENQUEUEING the job through the BQC-3 producer contract (createJobQueue +
// jobEnqueueOptions — catalogue retry policy; the dispatch gate re-authorizes
// at execution). Handlers are never invoked directly.
//
// DESTRUCTIVE: the sweeps delete expired data (bounded, evidence-writing).
// --apply requires the typed confirmation --yes ops:purge.
//
// Usage:
//   pnpm ops:purge <target> --operator <id>            — dry-run report
//   pnpm ops:purge <target> --operator <id> --reason <text> --apply --yes ops:purge
//
// Targets (background queue, bounded internally by the sweeps themselves):
//   reviews    — purge-expired-reviews (daily; atomic delete + evidence per review)
//   retention  — retention-sweep (daily; static registry, evidence in retention_runs)
//
// Report mode requires DATABASE_URL only. Apply also requires REDIS_URL. Every
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
import { runOperatorCommand } from './operator-command'

const TARGETS = {
  reviews: { jobName: 'purge-expired-reviews', capability: 'review.use' },
  // Retention is the data-lifecycle safety process — deliberately NOT
  // capability-gated so it still runs while product capabilities are killed.
  retention: { jobName: 'retention-sweep', capability: undefined },
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
  const { jobName, capability } = TARGETS[target as Target]

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
            'Google import lifecycle backlog is reported separately by ops:google-import-lifecycle inspect',
          )
          return
        }
        io.out(
          `would enqueue '${jobName}' on 'background' (catalogue retry policy) — re-run with --apply --yes ops:purge`,
        )
        return
      }

      const queue = createJobQueue('background')
      if (!queue) {
        io.err('REDIS_URL is not configured — cannot reach the background queue.')
        return 1
      }
      try {
        const job = await queue.add(jobName, {}, jobEnqueueOptions(jobName))
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
