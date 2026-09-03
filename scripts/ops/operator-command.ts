// Operator command harness wiring (BQC-7.5) — the module every scripts/ops/*
// command imports. Boots the minimal policy runtime against the ambient env
// (DATABASE_URL required; no dotenv — export env like the other ops scripts):
//
//   - the composite capability policy store (env posture + persisted tenant
//     state) with ONE strong read (refresh) before any decision, so operator
//     commands see DB truth, not the bootstrap env seed;
//   - the ExecutionPolicy with the identity-owned audit sink — every
//     evaluated invocation (allow AND deny) lands in policy_decision_audit
//     with actorType/executionKind 'operator';
//   - the named-operator allowlist from OPS_OPERATOR_IDENTITIES.
//
// The invocation contract (parse/validate/evaluate/run) lives in
// src/shared/ops/operator-command.ts with its unit tests — scripts/ sits
// outside tsconfig/eslint, so this file is wiring only.
//
// Commands receive one operator-projected Application Container on
// `ctx.container`. The harness builds it only after installing the policy
// runtime, so every command shares one bounded maintenance surface and cannot
// cold-boot the web singleton mid-run.

import { getDb } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import { getEnv } from '../../src/shared/config/env'
import { getLogger } from '../../src/shared/observability/logger'
import { initPersistedCapabilityPolicyStore } from '../../src/contexts/identity/infrastructure/policy-store-init'
import type { ExecutionPolicy } from '../../src/shared/auth/execution-policy'
import { createOperatorContainer } from '../../src/composition/deployables'
import { closeJobQueueConnections } from '../../src/shared/jobs/queue'
import type { OperatorContainer } from '../../src/composition/container-partition'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '../../src/shared/auth/process-policy-binding'
import { createPropertyRoutingLoader } from '../../src/contexts/property/infrastructure/property-routing.adapter'
import { createDataCellExecutionFence } from '../../src/shared/routing/data-cell-execution-fence'
import {
  runOperatorCommand as runCore,
  type OperatorArgs,
  type OperatorCommandResult,
  type OperatorContext,
  type OperatorIO,
  type OperatorCommandSpec,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'

type OperatorBoot = Readonly<{
  runtime: OperatorRuntime
  container: OperatorContainer
  /** The instance the runtime closure decides on — flushed before exit. */
  decidingPolicy: ExecutionPolicy
  cleanup: () => void
}>

/** Boot the policy runtime, then the bounded operator Application Container. */
async function bootOperatorRuntime(): Promise<OperatorBoot> {
  const db = getDb()
  const env = getEnv()
  const logger = getLogger(process.stderr)
  const dataCellExecutionFence = createDataCellExecutionFence({
    localCell: env.PROCESSING_CELL,
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
  })
  const handle = initPersistedCapabilityPolicyStore({
    db,
    env,
    clock: () => new Date(),
    logger,
    admitPropertyExecution: dataCellExecutionFence.decideProperty,
  })
  // ARC-03-T8: this is the ops process's ONE policy installation. The
  // ExecutionPolicy consults the process capability store, so the composite
  // store must be bound before any decision — returning the handle without
  // binding would silently evaluate operator commands against the env-only
  // fallback store.
  bindProcessPolicies(handle)
  const container = createOperatorContainer()
  // Strong read: operator decisions see persisted tenant state (suspensions,
  // allowlists), not just the env seed the bootstrap window runs on.
  await handle.refresh()
  return {
    runtime: { decide: (request) => handle.executionPolicy.decide(request) },
    decidingPolicy: handle.executionPolicy,
    container,
    cleanup: () => {
      handle.stopPolling()
      releaseProcessPolicies(handle)
    },
  }
}

/** Existing action contract enriched with the harness-owned operator surface. */
export type OpsAction = (
  ctx: OperatorContext & Readonly<{ container: OperatorContainer }>,
  args: OperatorArgs,
  io: OperatorIO,
) => Promise<number | void>

/**
 * Run an operator command through the real policy runtime. The action receives
 * the same operator-projected container that this harness shuts down, so it
 * cannot cold-boot a second, web-projected container.
 *
 * The decision audit is fire-and-forget in the long-lived application, but a
 * CLI exits immediately. Flush that exact deciding policy before releasing
 * the container and shared pool so the command's compliance row cannot race
 * process exit.
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OpsAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
  io?: OperatorIO,
): Promise<OperatorCommandResult> {
  const boot = await bootOperatorRuntime()
  const decidingPolicy = boot.decidingPolicy
  try {
    return await runCore(
      spec,
      (ctx, args, actionIO) =>
        action({ ...ctx, container: boot.container }, args, actionIO),
      boot.runtime,
      argv,
      io,
    )
  } finally {
    boot.cleanup()
    try {
      await decidingPolicy.flushAudits()
    } finally {
      const queues = new Set([
        boot.container.jobQueue,
        boot.container.backgroundQueue,
        boot.container.opsQueues.background,
        boot.container.opsQueues.domainEvents,
        boot.container.opsQueues.quarantine,
      ])
      try {
        await boot.container.shutdown.run()
        await Promise.all(Array.from(queues, (queue) => queue?.close()))
        await boot.container.providerEphemeralRedis?.quit()
      } finally {
        await closeJobQueueConnections()
        await closePool()
      }
    }
  }
}
