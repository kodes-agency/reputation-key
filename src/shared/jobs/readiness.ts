// BQC-3.6 — boot-time job readiness gate.
//
// Runs after bootstrap (all handlers/consumers registered), BEFORE any BullMQ
// worker starts. A mismatch between the event/job family catalogue and the
// registered runtime is a deployment/config failure — per the phase BQC-3
// failure taxonomy ("Unknown job/consumer → fail readiness") the worker boot
// FAILS rather than starting half-wired:
//
//   (a) every JOB_FAMILY_ROWS entry with registration 'enabled' has a handler
//       quarantined rows may retain an explicit safety/report handler;
//       denied_dark/blocked_capability rows MUST NOT retain a handler;
//   (b) every registered handler name exists in JOB_FAMILY_ROWS — a stale or
//       typo'd handler fails the boot. The 'domain-events' dispatcher is NOT
//       a registered handler: it is a queue-level worker created with its own
//       dispatch closure, so it never appears in the registry;
//   (c) every catalogued durable consumer ref is registered. The outbox
//       relay + dispatcher are the only delivery path, so a missing consumer
//       is a fact with no reader.

import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
} from '#/shared/governance/event-job-catalogue'
import type { ConsumerListing } from '#/shared/outbox'
import type { JobRegistry } from './registry'
import { validateOperationalCatalogueCoverage } from './operational-catalogue'

export type JobReadinessOptions = Readonly<{
  /**
   * ARC-03-T7: the container's consumer listing. REQUIRED — the old default
   * read a process-global registry, so readiness could pass against consumers
   * some other container registered. The caller must name the registry whose
   * worker is about to start.
   */
  listConsumers: () => ReadonlyArray<ConsumerListing>
}>

/** Minimal logging surface (pino satisfies this). */
export type ReadinessLogger = {
  info(obj: Readonly<Record<string, unknown>>, msg: string): void
}

function assertHandlersRegistered(registry: JobRegistry): void {
  const registered = new Set(registry.getAll().keys())
  const rowsByName = new Map(JOB_FAMILY_ROWS.map((row) => [row.jobName, row]))

  const missing = JOB_FAMILY_ROWS.filter(
    (r) => r.registration === 'enabled' && !registered.has(r.jobName),
  ).map((r) => r.jobName)
  const extra = [...registered].filter((name) => {
    const row = rowsByName.get(name)
    return (
      row === undefined ||
      row.registration === 'blocked_capability' ||
      row.registration === 'denied_dark'
    )
  })

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'job readiness failed (deployment/config mismatch): ' +
        `${missing.length} enabled catalogue job(s) without a handler [${missing.join(', ')}], ` +
        `${extra.length} registered handler(s) absent or forbidden by the catalogue [${extra.join(', ')}]`,
    )
  }
}

function assertDurableConsumersRegistered(
  listConsumers: JobReadinessOptions['listConsumers'],
): void {
  const registered = new Set(
    listConsumers().map((consumer) => `${consumer.eventType}::${consumer.consumerName}`),
  )
  const missing = EVENT_FAMILY_ROWS.flatMap((row) =>
    row.consumers.map((consumer) => `${row.eventType}::${consumer.name}`),
  ).filter((key) => !registered.has(key))

  if (missing.length > 0) {
    throw new Error(
      'durable consumer readiness failed (deployment/config mismatch): ' +
        `catalogued durable consumer(s) not registered [${missing.join(', ')}]`,
    )
  }
}

/**
 * Fail the worker boot when registered work and the catalogue disagree.
 * Throws on the first mismatch class found; logs the passing posture at info.
 */
export function assertJobReadiness(
  registry: JobRegistry,
  logger: ReadinessLogger,
  options: JobReadinessOptions,
): void {
  validateOperationalCatalogueCoverage()
  assertHandlersRegistered(registry)
  assertDurableConsumersRegistered(options.listConsumers)
  logger.info(
    { handlers: registry.getAll().size },
    'job readiness OK — handlers and durable consumers match the catalogue',
  )
}
