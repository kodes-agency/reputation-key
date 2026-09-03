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
//   (c) when the durable dispatcher is enabled, every catalogued durable
//       consumer ref is registered unless its cutover family is record-only.
//       Record-only deliberately has no durable consumer; shadow and switch
//       require one. While OUTBOX_DISPATCHER_ENABLED is off the remaining
//       consumer check is skipped and logged at info.

import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
} from '#/shared/governance/event-job-catalogue'
import type { ConsumerListing } from '#/shared/outbox'
import {
  INBOX_CUTOVER_FAMILIES,
  listActiveCutoverFamilies,
  type ActiveCutoverFamily,
} from '#/shared/outbox/cutover-flags'
import type { JobRegistry } from './registry'
import { validateOperationalCatalogueCoverage } from './operational-catalogue'

const INBOX_CUTOVER_CONSUMER_BY_FAMILY: Readonly<
  Record<(typeof INBOX_CUTOVER_FAMILIES)[number], string>
> = {
  'review.created': 'inbox.on-review-created',
  'review.expired': 'inbox.on-review-expired',
}

export type JobReadinessOptions = Readonly<{
  /** Validate durable consumer registration (only when the dispatcher runs). */
  dispatcherEnabled?: boolean
  /**
   * ARC-03-T7: the container's consumer listing. REQUIRED — the old default
   * read a process-global registry, so readiness could pass against consumers
   * some other container registered. The caller must name the registry whose
   * worker is about to start.
   */
  listConsumers: () => ReadonlyArray<ConsumerListing>
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
  activeCutoverFamilies: ReadonlyArray<ActiveCutoverFamily>,
): void {
  const registered = new Set(
    listConsumers().map((consumer) => `${consumer.eventType}::${consumer.consumerName}`),
  )
  const activeCutover = new Set(activeCutoverFamilies.map(({ family }) => family))
  const missing = EVENT_FAMILY_ROWS.flatMap((row) => {
    const cutoverFamily = INBOX_CUTOVER_FAMILIES.find(
      (family) => family === row.eventType,
    )
    const omittedRecordOnlyConsumer =
      cutoverFamily && !activeCutover.has(cutoverFamily)
        ? INBOX_CUTOVER_CONSUMER_BY_FAMILY[cutoverFamily]
        : null
    return row.consumers
      .filter(
        (consumer) =>
          consumer.kind === 'durable' && consumer.name !== omittedRecordOnlyConsumer,
      )
      .map((consumer) => `${row.eventType}::${consumer.name}`)
  }).filter((key) => !registered.has(key))

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
  options: JobReadinessOptions,
): void {
  validateOperationalCatalogueCoverage()
  const activeCutoverFamilies = (
    options.activeCutoverFamilies ?? listActiveCutoverFamilies
  )()
  assertCutoverDispatcher(activeCutoverFamilies, options.dispatcherEnabled === true)
  assertHandlersRegistered(registry)

  if (options.dispatcherEnabled) {
    assertDurableConsumersRegistered(options.listConsumers, activeCutoverFamilies)
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
