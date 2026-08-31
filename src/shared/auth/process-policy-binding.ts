// ARC-03-T8 — the ONE process installation of the policy trio.
//
// RULE: the ExecutionPolicy, the DelayedExecutionPolicy and the
// CapabilityPolicyStore are answered process-wide by exactly one owner, and
// that owner is named at a call site rather than acquired as a side effect of
// constructing something else.
//
// WHY: these three were installed from inside initPersistedCapabilityPolicyStore,
// which runs while a container is being BUILT. Any second container in the
// same process — a simulation, an operator command that calls getContainer()
// after booting its own policy runtime, a test fixture — silently re-pointed
// the process singletons at its own objects. The last builder won, invisibly,
// and the audit sink/consent reader a decision used no longer had to belong to
// the container that made it. Making the install explicit means a competing
// bind FAILS LOUDLY instead of quietly winning.
//
// The bound objects still come from a container (or from the operator
// harness's minimal policy boot): this module owns WHEN they become the
// process answer, not who constructs them.

import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import {
  initExecutionPolicy,
  registerExecutionPolicyInit,
  resetExecutionPolicy,
  type ExecutionPolicy,
} from './execution-policy'
import {
  initDelayedExecutionPolicy,
  registerDelayedExecutionPolicyInit,
  resetDelayedExecutionPolicy,
  type DelayedExecutionPolicy,
} from './system-execution-policy'

/**
 * The policy trio a container (or the operator policy boot) owns. Structural
 * on purpose: the binder must not depend on the composition root, or the
 * shared zone would import the container it exists to keep at arm's length.
 */
export type ProcessPolicyBundle = Readonly<{
  executionPolicy: ExecutionPolicy
  delayedExecutionPolicy: DelayedExecutionPolicy
  capabilityPolicyStore: CapabilityPolicyStore
}>

export const PROCESS_POLICY_ALREADY_BOUND = '[PROCESS POLICY] already bound'

let bound: ProcessPolicyBundle | undefined

/**
 * Install `policies` as the process-wide answer for all three policy reads.
 *
 * Re-binding the SAME bundle is a no-op (a process entry point and the
 * cold-boot fallback may both reach the singleton container). Binding a
 * DIFFERENT bundle throws: two policy runtimes in one process is a wiring
 * defect, and silently preferring one of them is how a decision ends up
 * auditing to the wrong container's sink.
 */
export function bindProcessPolicies(policies: ProcessPolicyBundle): void {
  if (bound === policies) return
  if (bound) {
    throw new Error(
      `${PROCESS_POLICY_ALREADY_BOUND} — a second container may not re-install the ` +
        'ExecutionPolicy, DelayedExecutionPolicy and CapabilityPolicyStore',
    )
  }
  bound = policies
  initCapabilityPolicyStore(policies.capabilityPolicyStore)
  initExecutionPolicy(policies.executionPolicy)
  initDelayedExecutionPolicy(policies.delayedExecutionPolicy)
}

/** The bundle currently answering process policy reads (diagnostics/tests). */
export function boundProcessPolicies(): ProcessPolicyBundle | undefined {
  return bound
}

/**
 * Drop the binding so a later bind may succeed. Shutdown and test teardown
 * only: it also clears the cold-boot fallback below (resetExecutionPolicy
 * does), so a long-lived process that releases without re-registering would
 * start throwing '[EXECUTION POLICY] not initialized' on the next read.
 *
 * Passing the bundle makes the release conditional — a caller releases only
 * the binding it owns and never another container's.
 */
export function releaseProcessPolicies(policies?: ProcessPolicyBundle): void {
  if (policies && bound !== policies) return
  bound = undefined
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
  resetDelayedExecutionPolicy()
}

/**
 * Cold-boot fallback for the long-lived web process.
 *
 * The container is a lazy singleton, but a policy check can precede the first
 * getContainer() call in a fresh process (requireExecutionAllowed runs before
 * the server function's own getContainer()). Without this, the first gated
 * request after every cold boot failed with '[EXECUTION POLICY] not
 * initialized'. The behaviour is unchanged; what changed is that a process
 * entry point now asks for it by name instead of the composition module
 * arranging it as an import-time side effect.
 */
export function registerProcessPolicyColdBoot(bind: () => void): void {
  registerExecutionPolicyInit(bind)
  registerDelayedExecutionPolicyInit(bind)
}
