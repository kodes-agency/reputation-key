// The declared capability posture against the real control tables and the
// real AI activation function. Every test runs inside one held transaction
// that always rolls back: AI control heads only ever move forward (a trigger
// rejects any other update), so nothing here may be committed to the shared
// test database.
//
// A seed-state AI head (generation 1) cannot be recreated inside a shared
// database, so the AI half proves the two properties that matter against the
// real SQL: an operator's kill or an enabled head is left exactly as it is,
// and the activation the deploy issues for a seed head is one the control
// function accepts and audits. The generation-1 decision itself is covered
// by the unit suites.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/domain/google-content-capability'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import { AI_PROVIDER_DEPLOYMENT_PROFILE_V1 } from '#/shared/ai-openai-provider-profile'
import type { DeclaredCapabilityPosture } from '#/shared/release/declared-capability-posture'
import {
  applyDeclaredCapabilityPosture,
  createDeclaredCapabilityPostureStores,
  declaredPostureAiTransition,
} from './declared-capability-posture'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const SHA = 'd'.repeat(40)
const PROFILE = AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion
const OPERATOR = 'owner:ops@example.com'

let held: HeldTransaction

beforeEach(async () => {
  held = await holdTransaction()
  // The exact rows drizzle/0002_db_seed.sql inserts on a fresh database.
  await held.client.query(`
    UPDATE capability_execution_control
    SET denied = true,
        emergency_kill_version = 1,
        denied_at = now(),
        drained_at = NULL,
        cleanup_drained_at = NULL,
        operator_id = CASE
          WHEN capability IN ('property.connect_gbp', 'property.publish_reply')
            THEN 'migration:0124'
        END,
        reason = CASE capability
          WHEN 'property.connect_gbp'
            THEN 'organization_ownership_expand_default_deny'
          WHEN 'property.publish_reply'
            THEN 'reply_publication_provider_authority_default_deny'
          ELSE 'migration_default_deny'
        END
  `)
})

afterEach(async () => {
  await held.rollBack()
})

type ControlRow = Readonly<{
  capability: string
  denied: boolean
  operator_id: string | null
  reason: string | null
  emergency_kill_version: string
}>

async function controlRows(): Promise<readonly ControlRow[]> {
  const result = await held.client.query<ControlRow>(`
    SELECT capability::text, denied, operator_id, reason, emergency_kill_version::text
    FROM capability_execution_control
    ORDER BY capability
  `)
  return result.rows
}

async function killedCapabilities() {
  const store = createGoogleContentAuthorityRepository(held.db)
  const control = await store.transaction((tx) => store.loadControl(tx))
  return control.killedCapabilities
}

function declare(
  google: DeclaredCapabilityPosture['google'],
  ai: DeclaredCapabilityPosture['ai'] = [],
): DeclaredCapabilityPosture {
  return { google, ai, candidateReleaseSha: ai.length > 0 ? SHA : null }
}

function apply(posture: DeclaredCapabilityPosture) {
  return applyDeclaredCapabilityPosture({
    stores: createDeclaredCapabilityPostureStores(held.db),
    posture,
    now: NOW,
  })
}

describe('declared Google content posture', () => {
  it('lifts every seed default declared with *, so the gate stops refusing', async () => {
    expect(await killedCapabilities()).toEqual([...GOOGLE_CONTENT_CAPABILITIES])

    const report = await apply(declare(GOOGLE_CONTENT_CAPABILITIES))

    expect(report.google.map(({ outcome }) => outcome)).toEqual([
      'lifted',
      'lifted',
      'lifted',
      'lifted',
    ])
    expect(await killedCapabilities()).toEqual([])
    const rows = await controlRows()
    expect(
      rows.map(({ denied, operator_id, reason }) => [denied, operator_id, reason]),
    ).toEqual(rows.map(() => [false, 'deploy:declared-posture', 'declared_posture']))
    // One shared emergency generation, advanced past the seed's.
    const generations = new Set(rows.map((row) => row.emergency_kill_version))
    expect(generations.size).toBe(1)
    expect(Number([...generations][0])).toBeGreaterThan(1)
  })

  it('leaves a denial an operator made in place', async () => {
    await held.client.query(
      `UPDATE capability_execution_control
       SET operator_id = $1, reason = 'incident'
       WHERE capability = 'property.publish_reply'`,
      [OPERATOR],
    )

    const report = await apply(declare(GOOGLE_CONTENT_CAPABILITIES))

    expect(report.google).toContainEqual({
      capability: 'property.publish_reply',
      outcome: 'kept_operator_denied',
    })
    expect(await killedCapabilities()).toEqual(['property.publish_reply'])
    expect(
      (await controlRows()).find((row) => row.capability === 'property.publish_reply'),
    ).toMatchObject({ denied: true, operator_id: OPERATOR, reason: 'incident' })
  })

  it('lifts only what is declared', async () => {
    await apply(declare(['property.connect_gbp']))

    expect(await killedCapabilities()).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
      'property.publish_reply',
    ])
  })

  it('restores a capability whose control row is missing', async () => {
    await held.client.query(
      `DELETE FROM capability_execution_control
       WHERE capability = 'property.read_gbp_performance'`,
    )

    const report = await apply(declare(['property.read_gbp_performance']))

    expect(report.google).toEqual([
      { capability: 'property.read_gbp_performance', outcome: 'lifted' },
    ])
    expect(await killedCapabilities()).not.toContain('property.read_gbp_performance')
  })

  it('converges: the next deploy changes nothing and keeps the generation', async () => {
    await apply(declare(GOOGLE_CONTENT_CAPABILITIES))
    const afterFirst = await controlRows()

    const second = await apply(declare(GOOGLE_CONTENT_CAPABILITIES))

    expect(second.google.map(({ outcome }) => outcome)).toEqual([
      'already_allowed',
      'already_allowed',
      'already_allowed',
      'already_allowed',
    ])
    expect(await controlRows()).toEqual(afterFirst)
  })
})

async function readAiHeads(capability: MerchantAiCapability) {
  const heads = await createAiControlAdapter(held.db).readHeads({
    providerDeploymentProfileVersion: PROFILE,
    capability,
  })
  const find = (kind: string) => heads.find((head) => head.scope.kind === kind)
  return {
    global: find('global'),
    provider: find('provider_deployment_profile'),
    capability: find('capability'),
  }
}

/** Fixture: the global and provider planes open, whatever other suites left. */
async function openAiPlane(): Promise<void> {
  const control = createAiControlAdapter(held.db)
  const heads = await readAiHeads('review_analysis')
  for (const head of [heads.global, heads.provider]) {
    if (!head) throw new Error('AI control plane head missing from the seed')
    if (head.executionState === 'enabled' && head.admissionState === 'accepting') continue
    const after = await control.transition({
      scope: head.scope,
      providerDeploymentProfileVersion: PROFILE,
      expectedControlId: head.controlId,
      expectedGeneration: head.generation,
      executionState: 'enabled',
      admissionState: 'accepting',
      reasonCode: 'operator_restore',
      actorUserId: OPERATOR,
      ticketReference: 'test-fixture',
      candidateReleaseSha: null,
    })
    if (!after) throw new Error('AI control plane could not be opened for the test')
  }
}

async function operatorTransition(
  capability: MerchantAiCapability,
  target: 'kill' | 'enable',
) {
  const { capability: head } = await readAiHeads(capability)
  if (!head) throw new Error(`AI control head missing: ${capability}`)
  const after = await createAiControlAdapter(held.db).transition({
    scope: head.scope,
    providerDeploymentProfileVersion: PROFILE,
    expectedControlId: head.controlId,
    expectedGeneration: head.generation,
    executionState: target === 'kill' ? 'killed' : 'enabled',
    admissionState: target === 'kill' ? 'draining' : 'accepting',
    reasonCode: target === 'kill' ? 'operator_kill' : 'operator_restore',
    actorUserId: OPERATOR,
    ticketReference: 'INC-1',
    candidateReleaseSha: target === 'kill' ? null : SHA,
  })
  if (!after) throw new Error(`operator ${target} refused for ${capability}`)
  return after
}

describe('declared AI capability posture', () => {
  beforeEach(openAiPlane)

  it('leaves a capability an operator killed exactly as it is', async () => {
    const killed = await operatorTransition('review_analysis', 'kill')

    const report = await apply(declare([], ['review_analysis']))

    expect(report.ai).toEqual([
      { capability: 'review_analysis', outcome: 'kept_operator_killed' },
    ])
    expect((await readAiHeads('review_analysis')).capability).toMatchObject({
      controlId: killed.controlId,
      generation: killed.generation,
      executionState: 'killed',
      admissionState: 'draining',
    })
  })

  it('leaves an enabled capability alone', async () => {
    await operatorTransition('property_trends', 'kill')
    const enabled = await operatorTransition('property_trends', 'enable')

    const report = await apply(declare([], ['property_trends']))

    expect(report.ai).toEqual([
      { capability: 'property_trends', outcome: 'already_enabled' },
    ])
    expect((await readAiHeads('property_trends')).capability?.generation).toBe(
      enabled.generation,
    )
  })

  it('issues an activation the real control function accepts and audits', async () => {
    const killed = await operatorTransition('review_analysis', 'kill')

    const after = await createAiControlAdapter(held.db).transition(
      declaredPostureAiTransition({
        capability: 'review_analysis',
        head: killed,
        candidateReleaseSha: SHA,
      }),
    )

    expect(after).toMatchObject({
      generation: killed.generation + 1,
      executionState: 'enabled',
      admissionState: 'accepting',
    })
    const audit = await held.client.query(
      `SELECT reason_code, actor_user_id, ticket_reference, candidate_release_sha
       FROM ai_execution_control_transitions
       WHERE control_id = $1 AND generation = $2`,
      [killed.controlId, killed.generation + 1],
    )
    expect(audit.rows).toEqual([
      {
        reason_code: 'operator_restore',
        actor_user_id: 'deploy:declared-posture',
        ticket_reference: 'declared-posture',
        candidate_release_sha: SHA,
      },
    ])
  })
})
