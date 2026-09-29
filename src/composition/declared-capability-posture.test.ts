// Orchestration of the declared capability posture against in-memory stores:
// which store calls the deploy makes, with exactly which arguments, and which
// it must never make. The real SQL paths are covered by the integration suite
// next to this file.

import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import type {
  AiControlHead,
  AiControlPort,
  AiControlScope,
} from '#/contexts/ai/application/ports/ai-control.port'
import type { GoogleContentCapability } from '#/shared/domain/google-content-capability'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type { DeclaredCapabilityPosture } from '#/shared/release/declared-capability-posture'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import {
  applyDeclaredCapabilityPosture,
  type DeclaredCapabilityPostureStores,
} from './declared-capability-posture'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const SHA = 'c'.repeat(40)
// The profile AI dispatch runs under: the posture must read the same heads.
const PROFILE = AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion

type ControlRow = Readonly<{
  capability: GoogleContentCapability
  denied: boolean
  operatorId: string | null
  reason: string | null
}>

const SEED_GOOGLE_ROWS: readonly ControlRow[] = [
  {
    capability: 'property.import_gbp_v2',
    denied: true,
    operatorId: null,
    reason: 'migration_default_deny',
  },
  {
    capability: 'property.read_gbp_performance',
    denied: true,
    operatorId: null,
    reason: 'migration_default_deny',
  },
  {
    capability: 'property.connect_gbp',
    denied: true,
    operatorId: 'migration:0124',
    reason: 'organization_ownership_expand_default_deny',
  },
  {
    capability: 'property.publish_reply',
    denied: true,
    operatorId: 'migration:0124',
    reason: 'reply_publication_provider_authority_default_deny',
  },
]

function fakeGoogle(rows: readonly ControlRow[]) {
  const events: string[] = []
  const allowed: Array<
    Readonly<{
      capability: GoogleContentCapability
      input: Readonly<{ operatorId: string; reason: string; changedAt: Date }>
    }>
  > = []
  const tx = {} as Database
  const store: DeclaredCapabilityPostureStores['google'] = {
    transaction: async (run) => {
      events.push('begin')
      const result = await run(tx)
      events.push('commit')
      return result
    },
    lockCapabilityControls: async (inTx) => {
      expect(inTx).toBe(tx)
      events.push('lock')
      return rows
    },
    allowCapability: async (inTx, capability, input) => {
      expect(inTx).toBe(tx)
      events.push(`allow:${capability}`)
      allowed.push({ capability, input })
      return allowed.length + 1
    },
  }
  return { store, events, allowed }
}

type HeadState = Pick<AiControlHead, 'generation' | 'executionState' | 'admissionState'>

const ENABLED: HeadState = {
  generation: 1,
  executionState: 'enabled',
  admissionState: 'accepting',
}
const SEED_KILLED: HeadState = {
  generation: 1,
  executionState: 'killed',
  admissionState: 'draining',
}

function head(scope: AiControlScope, state: HeadState, controlId: string): AiControlHead {
  return { scope, controlId, updatedAtEpochMillis: 0, ...state }
}

type AiPlaneState = Readonly<{
  global?: HeadState
  provider?: HeadState
  capabilities: Partial<Record<MerchantAiCapability, HeadState>>
}>

/**
 * `refusal` models a compare-and-set lost to a concurrent move: the
 * transition is refused and every later read sees `refusal.movedTo`.
 */
function fakeAi(initial: AiPlaneState, refusal?: Readonly<{ movedTo: AiPlaneState }>) {
  const transitions: Array<Parameters<AiControlPort['transition']>[0]> = []
  const reads: string[] = []
  let current = initial
  const port: AiControlPort = {
    readHeads: async ({ providerDeploymentProfileVersion, capability }) => {
      reads.push(`${providerDeploymentProfileVersion}:${capability}`)
      const heads: AiControlHead[] = []
      if (current.global) {
        heads.push(head({ kind: 'global' }, current.global, 'global-id'))
      }
      if (current.provider) {
        heads.push(
          head(
            { kind: 'provider_deployment_profile', providerDeploymentProfileVersion },
            current.provider,
            'provider-id',
          ),
        )
      }
      const state = current.capabilities[capability]
      if (state) {
        heads.push(head({ kind: 'capability', capability }, state, `${capability}-id`))
      }
      return heads
    },
    transition: async (transition) => {
      transitions.push(transition)
      if (refusal) {
        current = refusal.movedTo
        return null
      }
      return {
        scope: transition.scope,
        controlId: transition.expectedControlId,
        generation: transition.expectedGeneration + 1,
        executionState: transition.executionState,
        admissionState: transition.admissionState,
        updatedAtEpochMillis: NOW.getTime(),
      }
    },
  }
  return { port, transitions, reads }
}

function posture(
  google: readonly GoogleContentCapability[],
  ai: readonly MerchantAiCapability[] = [],
): DeclaredCapabilityPosture {
  return { google, ai, candidateReleaseSha: ai.length > 0 ? SHA : null }
}

describe('applyDeclaredCapabilityPosture', () => {
  it('touches no store when nothing is declared', async () => {
    const google = fakeGoogle(SEED_GOOGLE_ROWS)
    const ai = fakeAi({ capabilities: {} })

    const report = await applyDeclaredCapabilityPosture({
      stores: { google: google.store, ai: ai.port },
      posture: posture([]),
      now: NOW,
    })

    expect(report).toEqual({ google: [], ai: [] })
    expect(google.events).toEqual([])
    expect(ai.reads).toEqual([])
  })

  it('lifts the seed defaults through allowCapability, inside the locking transaction', async () => {
    const google = fakeGoogle(SEED_GOOGLE_ROWS)

    const report = await applyDeclaredCapabilityPosture({
      stores: { google: google.store, ai: fakeAi({ capabilities: {} }).port },
      posture: posture(['property.connect_gbp', 'property.import_gbp_v2']),
      now: NOW,
    })

    expect(google.events).toEqual([
      'begin',
      'lock',
      'allow:property.connect_gbp',
      'allow:property.import_gbp_v2',
      'commit',
    ])
    expect(google.allowed.map(({ input }) => input)).toEqual([
      {
        operatorId: 'deploy:declared-posture',
        reason: 'declared_posture',
        changedAt: NOW,
      },
      {
        operatorId: 'deploy:declared-posture',
        reason: 'declared_posture',
        changedAt: NOW,
      },
    ])
    expect(report.google).toEqual([
      { capability: 'property.connect_gbp', outcome: 'lifted' },
      { capability: 'property.import_gbp_v2', outcome: 'lifted' },
    ])
  })

  it('keeps an operator denial and lifts a capability with no row', async () => {
    const google = fakeGoogle([
      {
        capability: 'property.publish_reply',
        denied: true,
        operatorId: 'owner:ops',
        reason: 'incident',
      },
      {
        capability: 'property.connect_gbp',
        denied: false,
        operatorId: 'owner:ops',
        reason: 'restored',
      },
    ])

    const report = await applyDeclaredCapabilityPosture({
      stores: { google: google.store, ai: fakeAi({ capabilities: {} }).port },
      posture: posture([
        'property.read_gbp_performance',
        'property.connect_gbp',
        'property.publish_reply',
      ]),
      now: NOW,
    })

    expect(google.allowed.map(({ capability }) => capability)).toEqual([
      'property.read_gbp_performance',
    ])
    expect(report.google).toEqual([
      { capability: 'property.read_gbp_performance', outcome: 'lifted' },
      { capability: 'property.connect_gbp', outcome: 'already_allowed' },
      { capability: 'property.publish_reply', outcome: 'kept_operator_denied' },
    ])
  })

  it('enables a seed AI head with the exact activation the SQL function audits', async () => {
    const ai = fakeAi({
      global: ENABLED,
      provider: ENABLED,
      capabilities: { review_analysis: SEED_KILLED },
    })

    const report = await applyDeclaredCapabilityPosture({
      stores: { google: fakeGoogle([]).store, ai: ai.port },
      posture: posture([], ['review_analysis']),
      now: NOW,
    })

    expect(ai.reads).toEqual([`${PROFILE}:review_analysis`])
    expect(ai.transitions).toEqual([
      {
        scope: { kind: 'capability', capability: 'review_analysis' },
        providerDeploymentProfileVersion: PROFILE,
        expectedControlId: 'review_analysis-id',
        expectedGeneration: 1,
        executionState: 'enabled',
        admissionState: 'accepting',
        reasonCode: 'operator_restore',
        actorUserId: 'deploy:declared-posture',
        ticketReference: 'declared-posture',
        candidateReleaseSha: SHA,
      },
    ])
    expect(report.ai).toEqual([{ capability: 'review_analysis', outcome: 'enabled' }])
  })

  it('never transitions an operator kill, an enabled head or a stopped plane', async () => {
    const operatorKilled = fakeAi({
      global: ENABLED,
      provider: ENABLED,
      capabilities: {
        reply_drafting: { ...SEED_KILLED, generation: 4 },
        property_trends: { ...ENABLED, generation: 2 },
      },
    })
    const planeStopped = fakeAi({
      global: { ...SEED_KILLED, generation: 2 },
      provider: ENABLED,
      capabilities: { review_analysis: SEED_KILLED },
    })

    const kept = await applyDeclaredCapabilityPosture({
      stores: { google: fakeGoogle([]).store, ai: operatorKilled.port },
      posture: posture([], ['reply_drafting', 'property_trends']),
      now: NOW,
    })
    const skipped = await applyDeclaredCapabilityPosture({
      stores: { google: fakeGoogle([]).store, ai: planeStopped.port },
      posture: posture([], ['review_analysis']),
      now: NOW,
    })

    expect(operatorKilled.transitions).toEqual([])
    expect(planeStopped.transitions).toEqual([])
    expect(kept.ai).toEqual([
      { capability: 'reply_drafting', outcome: 'kept_operator_killed' },
      { capability: 'property_trends', outcome: 'already_enabled' },
    ])
    expect(skipped.ai).toEqual([
      { capability: 'review_analysis', outcome: 'skipped_plane_stopped' },
    ])
  })

  it('reports the operator move that beat it to the head, without failing', async () => {
    const seed: AiPlaneState = {
      global: ENABLED,
      provider: ENABLED,
      capabilities: { reply_drafting: SEED_KILLED },
    }
    const ai = fakeAi(seed, {
      movedTo: {
        ...seed,
        capabilities: { reply_drafting: { ...SEED_KILLED, generation: 2 } },
      },
    })

    const report = await applyDeclaredCapabilityPosture({
      stores: { google: fakeGoogle([]).store, ai: ai.port },
      posture: posture([], ['reply_drafting']),
      now: NOW,
    })

    expect(ai.transitions).toHaveLength(1)
    expect(ai.reads).toEqual([`${PROFILE}:reply_drafting`, `${PROFILE}:reply_drafting`])
    expect(report.ai).toEqual([
      { capability: 'reply_drafting', outcome: 'kept_operator_killed' },
    ])
  })

  it('fails loudly when a seed head that did not move still refuses activation', async () => {
    const seed: AiPlaneState = {
      global: ENABLED,
      provider: ENABLED,
      capabilities: { property_trends: SEED_KILLED },
    }
    const ai = fakeAi(seed, { movedTo: seed })

    await expect(
      applyDeclaredCapabilityPosture({
        stores: { google: fakeGoogle([]).store, ai: ai.port },
        posture: posture([], ['property_trends']),
        now: NOW,
      }),
    ).rejects.toThrow(/AI capability property_trends was not enabled/)
    expect(ai.transitions).toHaveLength(1)
  })

  it('refuses to activate without a release revision to record', async () => {
    const ai = fakeAi({
      global: ENABLED,
      provider: ENABLED,
      capabilities: { review_analysis: SEED_KILLED },
    })

    await expect(
      applyDeclaredCapabilityPosture({
        stores: { google: fakeGoogle([]).store, ai: ai.port },
        posture: { google: [], ai: ['review_analysis'], candidateReleaseSha: null },
        now: NOW,
      }),
    ).rejects.toThrow(/review_analysis needs a release revision/)
    expect(ai.transitions).toEqual([])
  })
})
