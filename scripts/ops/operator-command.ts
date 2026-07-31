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
// getContainer() inside their action; the container re-installs the same
// policy singletons (identical deps) — the process exits after the command.

import { getDb } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import { getEnv } from '../../src/shared/config/env'
import { initPersistedCapabilityPolicyStore } from '../../src/contexts/identity/infrastructure/policy-store-init'
import { getExecutionPolicy } from '../../src/shared/auth/execution-policy'
import {
  runOperatorCommand as runCore,
  type OperatorAction,
  type OperatorCommandResult,
  type OperatorCommandSpec,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'

export type OperatorBoot = Readonly<{
  runtime: OperatorRuntime
  cleanup: () => void
}>

/** Boot the minimal operator policy runtime (capability store + both policies). */
export async function bootOperatorRuntime(): Promise<OperatorBoot> {
  const db = getDb()
  const handle = initPersistedCapabilityPolicyStore({ db, env: getEnv() })
  // Strong read: operator decisions see persisted tenant state (suspensions,
  // allowlists), not just the env seed the bootstrap window runs on.
  await handle.refresh()
  return {
    runtime: { decide: (request) => getExecutionPolicy().decide(request) },
    cleanup: () => handle.stopPolling(),
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
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OperatorAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
): Promise<OperatorCommandResult> {
  const boot = await bootOperatorRuntime()
  try {
    return await runCore(spec, action, boot.runtime, argv)
  } finally {
    boot.cleanup()
    await getExecutionPolicy().flushAudits()
    await closePool()
  }
}
