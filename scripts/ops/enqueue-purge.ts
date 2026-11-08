// Operator CLI (BQC-7.5): bounded re-run of a purge/retention sweep by
// ENQUEUEING the job through the BQC-3 producer contract (createJobQueue +
// jobEnqueueOptions — catalogue retry policy; the dispatch gate re-authorizes
// at execution). Handlers are never invoked directly.
//
// DESTRUCTIVE: retention deletes expired data (bounded, evidence-writing), so
// --apply requires the typed confirmation --yes ops:purge. Review apply also
// needs the worker's separately approved lifecycle authority; it ships absent.
//
// Usage:
//   pnpm ops purge <target> --operator <id>            — dry-run report
//   pnpm ops purge <target> --operator <id> --reason <text> --apply --yes ops:purge
//
// Targets (background queue, bounded internally by the sweeps themselves):
//   reviews         — checkpointed lifecycle eligibility report (no mutation)
//   reviews-shadow  — checkpointed expand/cache parity report (no mutation)
//   retention  — retention-sweep (daily; static registry, evidence in retention_runs)
//
// Report mode requires DATABASE_URL only. Apply also requires QUEUE_REDIS_URL. Every
// invocation is policy-evaluated by the harness, which stores no record of it;
// an enqueued apply is re-authorized by the BQC-3 dispatch gate at execution.
// Runbook §10: purge requires operator confirmation + evidence report.

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJobQueue } from '../../src/shared/jobs/queue'
import { jobEnqueueOptions } from '../../src/shared/jobs/job-policy'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { getDb } from '../../src/shared/db'
import { GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT } from '../../src/shared/jobs/retention-sweep.job'
import { RETENTION_RULES } from '../../src/composition/retention-rules'
import { SCHEDULED_RETENTION_ACTIVE } from '../../src/shared/db/retention/scheduled-retention-activation'
import { buildRetentionRuleReport } from '../../src/shared/db/retention/report-retention-rules'
import { reputationReplyScopeEffects } from '../../src/composition/reply-scope-effects'
import { wireReviewSourceContentLifecycle } from '../../src/contexts/review/build'
import { collectReviewSourceContentLifecycleReport } from '../../src/contexts/review/application/use-cases/collect-source-content-lifecycle-report'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION } from '../../src/contexts/review/application/use-cases/run-source-content-lifecycle'
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

const USAGE = `pnpm ops purge <${Object.keys(TARGETS).join('|')}> --operator <id> [--reason <text> --apply --yes ops:purge]`

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

export async function main(): Promise<void> {
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
                scheduledApplyActive: SCHEDULED_RETENTION_ACTIVE,
                separatelyInspectedSubjects: [GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT],
                ...report,
              },
              null,
              2,
            ),
          )
          io.out(
            SCHEDULED_RETENTION_ACTIVE
              ? 'report is content-free and read-only; re-run with --apply --yes ops:purge to enqueue the bounded apply'
              : 'report is content-free and read-only; scheduled retention is inactive pending an owner-approved activation release',
          )
          io.out(
            'Google import lifecycle backlog is no longer reported: the compatibility surface was deleted with its five tables.',
          )
          return
        }
        const runLifecycle = wireReviewSourceContentLifecycle({
          db: getDb(),
          clock: () => new Date(),
          replyEffects: reputationReplyScopeEffects,
        })
        const report = await collectReviewSourceContentLifecycleReport(runLifecycle, {
          mode: lifecycleMode ?? 'report',
          batchSize: 100,
        })
        io.out(JSON.stringify({ target, ...report }, null, 2))
        io.out(
          'report is content-free and read-only; destructive apply remains unavailable pending external shadow parity and cutover approval',
        )
        return
      }

      if (target === 'reviews-shadow') {
        io.err(
          'Shadow inspection is read-only. Use the reviews target for approved expiry apply.',
        )
        return 1
      }

      if (target === 'retention' && !SCHEDULED_RETENTION_ACTIVE) {
        io.err(
          'Scheduled retention is inactive; an owner-approved activation release is required before apply.',
        )
        return 1
      }

      const queue = createJobQueue('background')
      if (!queue) {
        io.err('QUEUE_REDIS_URL is not configured — cannot reach the background queue.')
        return 1
      }
      try {
        const job = await queue.add(
          jobName,
          lifecycleMode == null
            ? {}
            : {
                mode: 'apply',
                applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
              },
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('ops:purge failed')
    process.exit(1)
  })
}
