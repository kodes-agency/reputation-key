// Applies the declared capability posture to the control tables (ADR 0032,
// amended 2026-09-29). Called by scripts/migrate-deploy.ts — web's Railway
// preDeployCommand — right after the schema tracks, inside the same
// advisory-locked step, so a database reset followed by a deploy comes back
// with the environment's declared capabilities instead of dark.
//
// Decisions come from src/shared/release/declared-capability-posture.ts; this
// module only reads the controls and makes the changes through the existing
// authorities: `allowCapability` (which advances the shared Google emergency
// generation correctly) and the AI control adapter's compare-and-set
// `transition` (transition_ai_execution_control_v1, which audits the change).
// Nothing is written when nothing needs to change, so a routine deploy leaves
// the emergency generation and every AI head exactly where they were.

import type { Database } from '#/shared/db'
import { AI_PROVIDER_DEPLOYMENT_PROFILE_V1 } from '#/shared/ai-openai-provider-profile'
import type { GoogleContentCapability } from '#/shared/domain/google-content-capability'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import {
  DECLARED_POSTURE_ACTOR,
  DECLARED_POSTURE_AI_REASON_CODE,
  DECLARED_POSTURE_GOOGLE_REASON,
  DECLARED_POSTURE_TICKET,
  decideAiCapabilityPosture,
  decideGoogleCapabilityPosture,
  type DeclaredCapabilityPosture,
  type DeclaredCapabilityPostureReport,
} from '#/shared/release/declared-capability-posture'
import type {
  AiControlHead,
  AiControlPort,
} from '#/contexts/ai/application/ports/ai-control.port'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import {
  createGoogleContentAuthorityRepository,
  type GoogleContentAuthorityRepository,
} from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'

export type DeclaredCapabilityPostureStores = Readonly<{
  google: Pick<
    GoogleContentAuthorityRepository,
    'transaction' | 'lockCapabilityControls' | 'allowCapability'
  >
  ai: AiControlPort
}>

export function createDeclaredCapabilityPostureStores(
  db: Database,
): DeclaredCapabilityPostureStores {
  return {
    google: createGoogleContentAuthorityRepository(db),
    ai: createAiControlAdapter(db),
  }
}

type AiTransitionInput = Parameters<AiControlPort['transition']>[0]

/**
 * The activation the posture issues for a seed-state AI capability head —
 * the same shape as `pnpm ops ai-control restore capability`, with the deploy
 * as the actor.
 */
export function declaredPostureAiTransition(
  input: Readonly<{
    capability: MerchantAiCapability
    head: Pick<AiControlHead, 'controlId' | 'generation'>
    candidateReleaseSha: string
  }>,
): AiTransitionInput {
  return {
    scope: { kind: 'capability', capability: input.capability },
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion,
    expectedControlId: input.head.controlId,
    expectedGeneration: input.head.generation,
    executionState: 'enabled',
    admissionState: 'accepting',
    reasonCode: DECLARED_POSTURE_AI_REASON_CODE,
    actorUserId: DECLARED_POSTURE_ACTOR,
    ticketReference: DECLARED_POSTURE_TICKET,
    candidateReleaseSha: input.candidateReleaseSha,
  }
}

async function applyGooglePosture(
  store: DeclaredCapabilityPostureStores['google'],
  declared: ReadonlyArray<GoogleContentCapability>,
  now: Date,
): Promise<DeclaredCapabilityPostureReport['google']> {
  if (declared.length === 0) return []
  // Read and change under one lock, so an operator's denial either lands
  // before the read (and is kept) or after the commit (and wins).
  return store.transaction(async (tx) => {
    const controls = await store.lockCapabilityControls(tx)
    const report = declared.map((capability) => ({
      capability,
      outcome: decideGoogleCapabilityPosture(
        controls.find((control) => control.capability === capability),
      ),
    }))
    for (const { capability, outcome } of report) {
      if (outcome !== 'lifted') continue
      await store.allowCapability(tx, capability, {
        operatorId: DECLARED_POSTURE_ACTOR,
        reason: DECLARED_POSTURE_GOOGLE_REASON,
        changedAt: now,
      })
    }
    return report
  })
}

async function readAiDecision(control: AiControlPort, capability: MerchantAiCapability) {
  const heads = await control.readHeads({
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion,
    capability,
  })
  const head = heads.find((entry) => entry.scope.kind === 'capability')
  const outcome = decideAiCapabilityPosture({
    global: heads.find((entry) => entry.scope.kind === 'global'),
    provider: heads.find((entry) => entry.scope.kind === 'provider_deployment_profile'),
    capability: head,
  })
  return { head, outcome }
}

async function applyAiCapability(
  control: AiControlPort,
  capability: MerchantAiCapability,
  candidateReleaseSha: string | null,
): Promise<DeclaredCapabilityPostureReport['ai'][number]> {
  const first = await readAiDecision(control, capability)
  if (first.outcome !== 'enabled' || !first.head) {
    return { capability, outcome: first.outcome }
  }
  if (candidateReleaseSha === null) {
    throw new Error(
      `[declared-posture] AI capability ${capability} needs a release revision to enable`,
    )
  }
  // A seed head at generation 1 has never been enabled, so it has no AI
  // drafts for the transition's draft purge to remove.
  const after = await control.transition(
    declaredPostureAiTransition({ capability, head: first.head, candidateReleaseSha }),
  )
  if (after) return { capability, outcome: 'enabled' }
  // The compare-and-set lost: the head or the plane moved after the read.
  // Decide again on what is there now, so an operator's move wins.
  const second = await readAiDecision(control, capability)
  if (second.outcome !== 'enabled') return { capability, outcome: second.outcome }
  throw new Error(
    `[declared-posture] AI capability ${capability} was not enabled: the control ` +
      'function refused an activation of an unchanged seed head. Inspect the ' +
      'AI control heads before redeploying.',
  )
}

/**
 * Lift the declared capabilities that are still at their seed default and
 * report every declared capability's outcome. Throws only when a change the
 * posture decided to make is refused without anyone having moved the control;
 * a deliberate operator stop is reported, never an error.
 */
export async function applyDeclaredCapabilityPosture(
  input: Readonly<{
    stores: DeclaredCapabilityPostureStores
    posture: DeclaredCapabilityPosture
    now: Date
  }>,
): Promise<DeclaredCapabilityPostureReport> {
  const google = await applyGooglePosture(
    input.stores.google,
    input.posture.google,
    input.now,
  )
  // One capability at a time: the deploy step runs on a single connection, and
  // each activation opens its own transaction on it.
  let ai: DeclaredCapabilityPostureReport['ai'] = []
  for (const capability of input.posture.ai) {
    const outcome = await applyAiCapability(
      input.stores.ai,
      capability,
      input.posture.candidateReleaseSha,
    )
    ai = [...ai, outcome]
  }
  return { google, ai }
}
