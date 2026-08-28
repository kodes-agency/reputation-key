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
// Commands needing use cases (projection rebuild, policy admin, …) call
// getContainer() inside their action. ARC-03-T8: building that container no
// longer re-installs the policy singletons, so the boot-time runtime below
// stays authoritative for the whole command instead of being silently
// replaced mid-run.

import { getDb } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import { getEnv } from '../../src/shared/config/env'
import { getLogger } from '../../src/shared/observability/logger'
import { initPersistedCapabilityPolicyStore } from '../../src/contexts/identity/infrastructure/policy-store-init'
import type { ExecutionPolicy } from '../../src/shared/auth/execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '../../src/shared/auth/process-policy-binding'
import { createPropertyRoutingLoader } from '../../src/contexts/property/infrastructure/property-routing.adapter'
import { createDataCellExecutionFence } from '../../src/shared/routing/data-cell-execution-fence'
import {
  runOperatorCommand as runCore,
  type OperatorAction,
  type OperatorCommandResult,
  type OperatorIO,
  type OperatorCommandSpec,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'

type OperatorBoot = Readonly<{
  runtime: OperatorRuntime
  /** The instance the runtime closure decides on — flushed before exit. */
  decidingPolicy: ExecutionPolicy
  cleanup: () => void
}>

/** Boot the minimal operator policy runtime (capability store + both policies). */
async function bootOperatorRuntime(): Promise<OperatorBoot> {
  const db = getDb()
  const env = getEnv()
  const dataCellExecutionFence = createDataCellExecutionFence({
    localCell: env.PROCESSING_CELL,
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
  })
  const handle = initPersistedCapabilityPolicyStore({
    db,
    env,
    clock: () => new Date(),
    logger: getLogger(),
    admitPropertyExecution: dataCellExecutionFence.decideProperty,
  })
  // ARC-03-T8: this is the ops process's ONE policy installation. The
  // ExecutionPolicy consults the process capability store, so the composite
  // store must be bound before any decision — returning the handle without
  // binding would silently evaluate operator commands against the env-only
  // fallback store.
  bindProcessPolicies(handle)
  // Strong read: operator decisions see persisted tenant state (suspensions,
  // allowlists), not just the env seed the bootstrap window runs on.
  await handle.refresh()
  return {
    runtime: { decide: (request) => handle.executionPolicy.decide(request) },
    decidingPolicy: handle.executionPolicy,
    cleanup: () => {
      handle.stopPolling()
      releaseProcessPolicies(handle)
    },
  }
}

/**
 * Run an operator command through the harness against the real policy
 * runtime. Returns the exit code — the script owns process.exit.
 *
 * The finally-block flushes the decision audit writes, then drains the
 * shared pool: the ExecutionPolicy's audit write is fire-and-forget BY
 * DESIGN in the long-lived app process, but a CLI exits right after the
 * decision — without the flush, process.exit would race the INSERT and the
 * command's compliance record could be lost.
 *
 * The flush targets the boot instance the runtime actually decided on, held
 * on the boot handle rather than re-read from the process singleton. Before
 * ARC-03-T8 an action that called getContainer() re-installed the
 * ExecutionPolicy, so a getExecutionPolicy() read in this finally returned the
 * NEW instance (empty pending set) while the invocation's audit write on the
 * boot instance raced exit — observed as a missing compliance row on
 * fast-refusing commands (BQC-7.8 drill). A second container can no longer
 * re-install, and this no longer depends on that being true.
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OperatorAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
  io?: OperatorIO,
): Promise<OperatorCommandResult> {
  const boot = await bootOperatorRuntime()
  const decidingPolicy = boot.decidingPolicy
  try {
    return await runCore(spec, action, boot.runtime, argv, io)
  } finally {
    boot.cleanup()
    await decidingPolicy.flushAudits()
    await closePool()
  }
}
