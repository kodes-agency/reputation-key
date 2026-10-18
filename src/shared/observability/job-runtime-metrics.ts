// The governed job-runtime report's metrics (src/shared/jobs/runtime-observations.ts),
// registered in METRIC_DEFINITIONS (metrics-schema.ts), which type-checks each
// entry where it spreads them in. This module imports nothing, so the registry
// can take it without a cycle.

export const JOB_RUNTIME_METRIC_DEFINITIONS = [
  {
    name: 'worker.job_runtime.ready',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['jobs.ready'],
    emitted: true,
    description: '1 when every governed job family satisfies its runtime contract.',
  },
  {
    name: 'worker.job_runtime.families',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'jobs.total',
      'jobs.active',
      'jobs.dark',
      'jobs.quarantined',
      'jobs.failing',
    ],
    emitted: true,
    description: 'Governed job families by operational posture and readiness.',
  },
  {
    name: 'worker.job_runtime.failures',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'jobs.missingObservations',
      'jobs.invalidObservations',
      'jobs.handlerMissing',
      'jobs.schedulerMissing',
      'jobs.scheduleDenied',
      'jobs.forbiddenDarkWork',
      'jobs.quarantinedSchedulers',
      'jobs.missedObjectives',
      'jobs.queueAgeMissed',
      'jobs.stalled',
      'jobs.repairRequired',
      'jobs.deadLetters',
    ],
    emitted: true,
    description:
      'Job runtime contract failures, including missed work and repair ownership.',
  },
  {
    name: 'worker.job_runtime.gate_denials',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['jobs.gateDenials'],
    emitted: true,
    description:
      'Retained completed jobs the delayed-execution gate denied. Counted, never paged: a denied on-demand job is routine; a denied schedule firing fails readiness.',
  },
  {
    name: 'worker.job_runtime.terminal_failures',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['jobs.terminalFailures'],
    emitted: true,
    description:
      'Retained failed jobs, schedule firings and on-demand runs alike. Counted, never paged: an unanswered failure already fails readiness as repair_required.',
  },
] as const
