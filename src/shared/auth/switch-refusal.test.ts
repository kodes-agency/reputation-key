// Every switch refuses its group in both processes: the worker, which installs
// its store through the capability boot guard and decides queued work with the
// delayed policy, and web, which builds its policies in the composition root
// and decides interactive and guest requests.

import { afterEach, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, userId } from '#/shared/domain/ids'
import { buildCapabilityPolicyHandle } from '#/contexts/identity/infrastructure/policy-store-init'
import { runCapabilityBootGuard } from './capability-boot-guard'
import {
  checkScopedCapability,
  resetCapabilityPolicyStore,
  type FeatureSwitch,
} from './beta-capabilities'
import { bindProcessPolicies, releaseProcessPolicies } from './process-policy-binding'
import { createExecutionPolicy, type DecisionRequest } from './execution-policy'
import { createDelayedExecutionPolicy } from './system-execution-policy'

const ORG = 'org-switches'
const OTHER_ORG = 'org-switches-other'
const PROPERTY = 'd4000000-0000-4000-8000-000000000071'
const NOW = new Date('2026-11-12T09:00:00.000Z')

/** Query-free: no decision below may read the database. */
const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('a switch decision must not query the database')
    },
  },
) as unknown as Database

const quietLogger = { info: () => {} }

// ── Worker ──────────────────────────────────────────────────────────

// Guest traffic queues no work: the worker reads the same store a guest
// request is decided against, so its proof is that store's decision.
const WORKER_WORK: Readonly<
  Record<FeatureSwitch, Readonly<{ action: string; propertyId?: string }> | null>
> = {
  google: { action: 'system:reply.publish', propertyId: PROPERTY },
  ai: { action: 'system:ai.review_analysis_on_demand', propertyId: PROPERTY },
  guest_pages: null,
  optional_email: { action: 'system:notification.email_urgent' },
}

async function workerDecision(
  env: Readonly<Record<string, string>>,
  featureSwitch: FeatureSwitch,
  organization = ORG,
) {
  runCapabilityBootGuard({ NODE_ENV: 'production', ...env }, quietLogger)
  const work = WORKER_WORK[featureSwitch]
  if (work === null) {
    return checkScopedCapability(
      { organizationId: organization },
      'portal.guest_response',
    )
  }
  const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
  return policy.decide({
    principal: { kind: 'system', id: 'worker:default' },
    executionKind: 'worker',
    organizationId: organization,
    ...work,
    now: NOW,
  })
}

// ── Web ─────────────────────────────────────────────────────────────

const ADMIN = {
  userId: userId('user-switches-admin'),
  organizationId: organizationId(ORG),
  role: 'AccountAdmin',
} as const

const WEB_REQUEST: Readonly<Record<FeatureSwitch, DecisionRequest>> = {
  google: {
    principal: { kind: 'user', ctx: ADMIN },
    action: 'reply.manage',
    organizationId: ORG,
    executionKind: 'interactive',
    now: NOW,
  },
  ai: {
    principal: { kind: 'user', ctx: ADMIN },
    action: 'ai.reply.generate',
    organizationId: ORG,
    executionKind: 'interactive',
    now: NOW,
  },
  guest_pages: {
    principal: { kind: 'public' },
    action: 'public:portal.response.submit',
    capability: 'portal.guest_response',
    organizationId: ORG,
    executionKind: 'public',
    now: NOW,
  },
  optional_email: {
    principal: { kind: 'user', ctx: ADMIN },
    action: 'notification.update',
    capability: 'notification.send_email',
    organizationId: ORG,
    executionKind: 'interactive',
    now: NOW,
  },
}

async function webDecision(
  env: Readonly<Record<string, string>>,
  featureSwitch: FeatureSwitch,
) {
  const handle = buildCapabilityPolicyHandle({ db: dbStub, env, clock: () => NOW })
  bindProcessPolicies(handle)
  return handle.executionPolicy.decide(WEB_REQUEST[featureSwitch])
}

const SWITCHES: ReadonlyArray<FeatureSwitch> = [
  'google',
  'ai',
  'guest_pages',
  'optional_email',
]

afterEach(() => {
  releaseProcessPolicies()
  resetCapabilityPolicyStore()
})

describe.each(SWITCHES)('the %s switch', (featureSwitch) => {
  it('lets the worker run its work while on', async () => {
    const decision = await workerDecision({}, featureSwitch)
    expect(decision).toMatchObject({ allowed: true, reason: 'allowed' })
  })

  it('refuses the worker its work while off', async () => {
    const decision = await workerDecision(
      { BETA_CAPABILITIES_OFF: featureSwitch },
      featureSwitch,
    )
    expect(decision).toMatchObject({ allowed: false, reason: 'capability_disabled' })
  })

  it('lets web serve its requests while on', async () => {
    const decision = await webDecision({}, featureSwitch)
    expect(decision).toMatchObject({ allowed: true, reason: 'allowed' })
  })

  it('refuses web its requests while off', async () => {
    const decision = await webDecision(
      { BETA_CAPABILITIES_OFF: featureSwitch },
      featureSwitch,
    )
    expect(decision).toMatchObject({ allowed: false, reason: 'capability_disabled' })
  })

  it('leaves the other three groups running', async () => {
    for (const other of SWITCHES.filter((entry) => entry !== featureSwitch)) {
      expect(
        await workerDecision({ BETA_CAPABILITIES_OFF: featureSwitch }, other),
      ).toMatchObject({ allowed: true })
      releaseProcessPolicies()
      expect(
        await webDecision({ BETA_CAPABILITIES_OFF: featureSwitch }, other),
      ).toMatchObject({
        allowed: true,
      })
      releaseProcessPolicies()
    }
  })
})

describe('optional email off', () => {
  it('still sends mandatory notices from the worker', async () => {
    runCapabilityBootGuard({ BETA_CAPABILITIES_OFF: 'optional_email' }, quietLogger)
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
    const decision = await policy.decide({
      principal: { kind: 'system', id: 'worker:default' },
      executionKind: 'worker',
      organizationId: ORG,
      action: 'system:notification.email_mandatory',
      now: NOW,
    })
    expect(decision).toMatchObject({ allowed: true, reason: 'allowed' })
  })
})

describe('everything off', () => {
  it.each(SWITCHES)('refuses %s work in the worker and on web', async (featureSwitch) => {
    expect(
      await workerDecision({ BETA_CAPABILITIES_OFF: 'all' }, featureSwitch),
    ).toMatchObject({
      allowed: false,
      reason: 'capability_disabled',
    })
    expect(
      await webDecision({ BETA_CAPABILITIES_OFF: 'all' }, featureSwitch),
    ).toMatchObject({
      allowed: false,
      reason: 'capability_disabled',
    })
  })
})

describe('suspension', () => {
  it.each(SWITCHES)(
    'stops %s work for the suspended Organization only',
    async (featureSwitch) => {
      const env = { BETA_SUSPENDED_ORGS: ORG }
      expect(await workerDecision(env, featureSwitch)).toMatchObject({
        allowed: false,
        reason: 'org_suspended',
      })
      expect(await workerDecision(env, featureSwitch, OTHER_ORG)).toMatchObject({
        allowed: true,
      })
      expect(await webDecision(env, featureSwitch)).toMatchObject({
        allowed: false,
        reason: 'org_suspended',
      })
    },
  )
})

describe('a switch name the processes cannot read', () => {
  it('refuses to start the worker and web', () => {
    expect(() =>
      runCapabilityBootGuard(
        { BETA_CAPABILITIES_OFF: 'property.connect_gbp' },
        quietLogger,
      ),
    ).toThrow(/not a switch/)
    expect(() =>
      buildCapabilityPolicyHandle({
        db: dbStub,
        env: { BETA_CAPABILITIES_OFF: 'property.connect_gbp' },
        clock: () => NOW,
      }),
    ).toThrow(/not a switch/)
  })
})

describe('merchant AI consent', () => {
  it('still refuses AI with every switch on when the Property has not consented', async () => {
    runCapabilityBootGuard({}, quietLogger)
    const policy = createExecutionPolicy({
      listAccessiblePropertyIds: async () => [PROPERTY],
      hasActiveConsent: async () => false,
    })
    const decision = await policy.decide({
      ...WEB_REQUEST.ai,
      propertyId: PROPERTY,
      consent: {
        subjectType: 'property',
        subjectId: PROPERTY,
        purpose: 'ai.generate_reply',
      },
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'consent_required' })
  })
})
