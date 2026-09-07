// Operator command harness wiring (BQC-7.5) — the module every scripts/ops/*
// command imports. Boots the minimal policy runtime against the ambient env
// (DATABASE_URL required; no dotenv — export env like the other ops scripts):
//
//   - the process-static capability configuration, with tenant grants and
//     consent read live by the ExecutionPolicy;
//   - the ExecutionPolicy, which returns every evaluated allow or typed deny;
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
import { initCapabilityPolicyStore } from '../../src/contexts/identity/infrastructure/policy-store-init'
import { createOperatorContainer } from '../../src/composition/deployables'
import { closeJobQueueConnections } from '../../src/shared/jobs/queue'
import { OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE } from '../../src/composition/google-provider-authority'
import type { OperatorContainer } from '../../src/composition/container-partition'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '../../src/shared/auth/process-policy-binding'
import {
  runOperatorCommand as runCore,
  type OperatorArgs,
  type OperatorCommandResult,
  type OperatorContext,
  type OperatorIO,
  type OperatorCommandSpec,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'

/**
 * Refuse provider work before command-specific catch/report logic can flatten
 * the missing authority. Report-only paths still run against persisted state.
 */
const GOOGLE_PROVIDER_OPERATOR_COMMANDS: Readonly<Record<string, true>> = {
  'ops:disconnect-connection': true,
  'ops:gbp-subscribe': true,
  'ops:reconcile-publication': true,
}

function refuseProviderDependentApply(
  spec: OperatorCommandSpec,
  ctx: OperatorContext,
): void {
  if (ctx.dryRun || !GOOGLE_PROVIDER_OPERATOR_COMMANDS[spec.name]) return
  throw new Error(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
}

type OperatorBoot = Readonly<{
  runtime: OperatorRuntime
  container: OperatorContainer
  /** Release the process policy binding. */
  cleanup: () => void
}>

/** Boot the policy runtime, then the bounded operator Application Container. */
async function bootOperatorRuntime(): Promise<OperatorBoot> {
  const db = getDb()
  const env = getEnv()
  const logger = getLogger(process.stderr)
  const handle = initCapabilityPolicyStore({
    db,
    env,
    clock: () => new Date(),
    logger,
  })
  // This is the ops process's one static policy installation. Tenant grants
  // and consent remain live through the execution policy's repositories.
  bindProcessPolicies(handle)
  const container = createOperatorContainer()
  // Preserve the shared boot contract; static policy observation is immediate.
  await handle.refresh()
  return {
    runtime: { decide: (request) => handle.executionPolicy.decide(request) },
    container,
    cleanup: () => {
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
 * Cleanup releases the policy binding and closes the bounded operator
 * container, queues, and shared database pool.
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OpsAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
  io?: OperatorIO,
): Promise<OperatorCommandResult> {
  const boot = await bootOperatorRuntime()
  try {
    return await runCore(
      spec,
      (ctx, args, actionIO) => {
        refuseProviderDependentApply(spec, ctx)
        return action({ ...ctx, container: boot.container }, args, actionIO)
      },
      boot.runtime,
      argv,
      io,
    )
  } finally {
    boot.cleanup()
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
    } finally {
      await closeJobQueueConnections()
      await closePool()
    }
  }
}
