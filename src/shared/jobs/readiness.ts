// BQC-3.6 — boot-time job readiness gate.
//
// Runs after bootstrap (all handlers/consumers registered), BEFORE any BullMQ
// worker starts. A mismatch between the event/job family catalogue and the
// registered runtime is a deployment/config failure — per the phase BQC-3
// failure taxonomy ("Unknown job/consumer → fail readiness") the worker boot
// FAILS rather than starting half-wired:
//
//   (a) every JOB_FAMILY_ROWS entry with registration 'enabled' has a handler
//       (denied_dark/blocked_capability rows carry no-op handlers by design —
//       they pass the same way);
//   (b) every registered handler name exists in JOB_FAMILY_ROWS — a stale or
//       typo'd handler fails the boot. The 'domain-events' dispatcher is NOT
//       a registered handler: it is a queue-level worker created with its own
//       dispatch closure, so it never appears in the registry;
//   (c) when the durable dispatcher is enabled, every catalogued durable
//       consumer ref is registered. While OUTBOX_DISPATCHER_ENABLED is off
//       the consumers are intentionally inert (BQR-0 containment) — the check
//       is skipped and logged at info.

import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
} from '#/shared/governance/event-job-catalogue'
import { listRegisteredConsumers } from '#/shared/outbox/dispatcher'
import {
  listActiveCutoverFamilies,
  type ActiveCutoverFamily,
} from '#/shared/outbox/cutover-flags'
import type { JobRegistry } from './registry'

export type JobReadinessOptions = Readonly<{
  /** Validate durable consumer registration (only when the dispatcher runs). */
  dispatcherEnabled?: boolean
  /** Consumer listing seam — defaults to the dispatcher registry. */
  listConsumers?: () => ReadonlyArray<
    Readonly<{ eventType: string; consumerName: string }>
  >
  /**
   * BQC-3.9: families past record-only — defaults to the env resolution.
   * Any active family (shadow/switch) requires the durable dispatcher.
   */
  activeCutoverFamilies?: () => ReadonlyArray<ActiveCutoverFamily>
}>

/** Minimal logging surface (pino satisfies this). */
export type ReadinessLogger = {
  info(obj: Readonly<Record<string, unknown>>, msg: string): void
}

function assertHandlersRegistered(registry: JobRegistry): void {
  const registered = new Set(registry.getAll().keys())
  const catalogued = new Set(JOB_FAMILY_ROWS.map((r) => r.jobName))

  const missing = JOB_FAMILY_ROWS.filter(
    (r) => r.registration === 'enabled' && !registered.has(r.jobName),
  ).map((r) => r.jobName)
  const extra = [...registered].filter((name) => !catalogued.has(name))

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'job readiness failed (deployment/config mismatch): ' +
        `${missing.length} enabled catalogue job(s) without a handler [${missing.join(', ')}], ` +
        `${extra.length} registered handler(s) missing from the catalogue [${extra.join(', ')}]`,
    )
  }
}

function assertDurableConsumersRegistered(
  listConsumers: NonNullable<JobReadinessOptions['listConsumers']>,
): void {
  const registered = new Set(
    listConsumers().map((c) => `${c.eventType}::${c.consumerName}`),
  )
  const missing = EVENT_FAMILY_ROWS.flatMap((r) =>
    r.consumers
      .filter((c) => c.kind === 'durable')
      .map((c) => `${r.eventType}::${c.name}`),
  ).filter((key) => !registered.has(key))

  if (missing.length > 0) {
    throw new Error(
      'durable consumer readiness failed (deployment/config mismatch): ' +
        `catalogued durable consumer(s) not registered [${missing.join(', ')}]`,
    )
  }
}

/**
 * BQC-3.9: a family in shadow/switch runs the durable path — the boot fails
 * when the dispatcher is off, because the family would silently lose its
 * primary (switch) or comparison (shadow) delivery.
 */
function assertCutoverDispatcher(
  active: ReadonlyArray<ActiveCutoverFamily>,
  dispatcherEnabled: boolean,
): void {
  if (active.length === 0 || dispatcherEnabled) return
  const families = active.map((f) => `${f.family}=${f.state}`).join(', ')
  throw new Error(
    'durable cutover readiness failed (deployment/config mismatch): ' +
      `cutover famil${active.length === 1 ? 'y' : 'ies'} [${families}] require ` +
      'OUTBOX_DISPATCHER_ENABLED=true — shadow/switch families cannot run ' +
      'record-only (BQC-3.9)',
  )
}

/**
 * Fail the worker boot when registered work and the catalogue disagree.
 * Throws on the first mismatch class found; logs the passing posture at info.
 */
export function assertJobReadiness(
  registry: JobRegistry,
  logger: ReadinessLogger,
  options: JobReadinessOptions = {},
): void {
  assertCutoverDispatcher(
    (options.activeCutoverFamilies ?? listActiveCutoverFamilies)(),
    options.dispatcherEnabled === true,
  )
  assertHandlersRegistered(registry)

  if (options.dispatcherEnabled) {
    assertDurableConsumersRegistered(options.listConsumers ?? listRegisteredConsumers)
    logger.info(
      { handlers: registry.getAll().size, dispatcherEnabled: true },
      'job readiness OK — handlers and durable consumers match the catalogue',
    )
    return
  }

  logger.info(
    { handlers: registry.getAll().size, dispatcherEnabled: false },
    'job readiness OK — durable consumer validation skipped (dispatcher disabled)',
  )
}
