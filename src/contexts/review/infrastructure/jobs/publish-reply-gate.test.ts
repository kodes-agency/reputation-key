// BQC-3.8 §6 — revocation/suspension BETWEEN enqueue and send denies the
// side effect: the publish-reply job authorizes through the BQC-3.2 delayed
// execution gate at dispatch against CURRENT policy — a stale allow sitting
// in the queue never overrides a current deny.
//
// Focused companion to the 3.2 fixture tests (src/shared/jobs/
// delayed-execution-gate.test.ts), driven by the same shared BQC-2.5
// contract fixtures (execution ownership: BQC-2 IMPLEMENTS the contract,
// BQC-3 INTEGRATES it). The publish handler itself is never reached on a
// deny — the gated dispatch closure quarantines/completes before invocation.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { gateJob } from '#/shared/jobs/delayed-execution-gate'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { DELAYED_CONTRACT_FIXTURES } from '#/shared/auth/system-execution-policy.fixtures'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'

const PROP = 'd4000000-0000-4000-8000-000000000051'

/** Install the REAL BQC-2.5 policy against a fixture env (3.2 test idiom). */
function installRealPolicy(env: CapabilityPolicyEnv) {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  const refreshPolicy = vi.fn(async () => {})
  initDelayedExecutionPolicy(createDelayedExecutionPolicy({ refreshPolicy }))
  return refreshPolicy
}

function fixtureEnv(namePart: string): CapabilityPolicyEnv {
  const fixture = DELAYED_CONTRACT_FIXTURES.find((f) => f.name.includes(namePart))
  if (!fixture) throw new Error(`fixture not found: ${namePart}`)
  return fixture.env
}

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

/** The publish-reply envelope exactly as approveReply/retryPublish enqueue it. */
const PUBLISH_ENVELOPE = {
  replyId: 'reply-1',
  organizationId: 'org-fixture',
  propertyId: PROP,
  policy: {
    initiator: { kind: 'user', id: 'user-9' },
    policyVersionAtEnqueue: 'bqc-0.3',
  },
}

describe('publish-reply through the delayed execution gate (§6: revocation/suspension between enqueue and send)', () => {
  it('org suspended after enqueue → deny_terminal (org_suspended): the Google send never runs', async () => {
    installRealPolicy(fixtureEnv('org suspended'))

    const outcome = await gateJob(
      'publish-reply',
      PUBLISH_ENVELOPE,
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('deny_terminal')
    expect(outcome.decision.reason).toBe('org_suspended')
  })

  it('property.publish_reply killed after enqueue → deny_terminal (capability_disabled): a stale allow never overrides', async () => {
    // Same kill-switch mechanism as the 'capability killed' fixture, aimed at
    // the publish capability itself.
    installRealPolicy({ BETA_CAPABILITIES_OFF: 'property.publish_reply' })

    const outcome = await gateJob(
      'publish-reply',
      PUBLISH_ENVELOPE,
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('deny_terminal')
    expect(outcome.decision.reason).toBe('capability_disabled')
  })

  it('current policy still allows → allow (external effect requires the fresh read)', async () => {
    const refreshPolicy = installRealPolicy(fixtureEnv('current allow'))

    const outcome = await gateJob(
      'publish-reply',
      PUBLISH_ENVELOPE,
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('allow')
    expect(outcome.decision.freshRead).toBe(true)
    expect(refreshPolicy).toHaveBeenCalledTimes(1)
  })
})
