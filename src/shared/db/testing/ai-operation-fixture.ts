// A real-PostgreSQL fixture for tests that drive the AI reservation ledger:
// one organization, one property, the reply-drafting capability control
// opened for the run, and pending `ai_operations` rows on demand.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  properties,
} from '#/shared/db/schema'
import { deleteTestOrganizationsWithExecutor } from './test-organization-cleanup'

/** The reply-suggestion profile as the seed and the operation rows spell it. */
export const AI_REPLY_OPERATION_PROFILE = Object.freeze({
  command: 'reply',
  capability: 'reply_drafting',
  profileVersion: 'reply-suggestion-v1',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
  routeKey: 'reply-suggestion',
})

export type AiOperationFixtureInput = Readonly<{
  db: Database
  organizationId: string
  propertyId: string
  actorUserId: string
  /** Stamped on every seeded row; keep it behind the database clock. */
  now: Date
}>

export type AiOperationSeed = Readonly<{
  id?: string
  state?: 'pending' | 'executing'
  executionAttempt?: number
  executionPermitId?: string | null
  sourceDigest?: string
  sourceByteCount?: number
}>

type ControlPosture = Readonly<{
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
}>

export type AiOperationFixture = Readonly<{
  /** Insert a reply operation row; returns its id. */
  seedOperation(seed?: AiOperationSeed): Promise<string>
  /** Delete the fixture rows and put the capability control back. */
  remove(): Promise<void>
}>

const CAPABILITY_SCOPE_KEY = `capability:${AI_REPLY_OPERATION_PROFILE.capability}`

async function transitionCapabilityControl(
  db: Database,
  actorUserId: string,
  posture: ControlPosture,
): Promise<void> {
  const [head] = await db
    .select()
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, CAPABILITY_SCOPE_KEY))
    .limit(1)
  if (!head) throw new Error(`AI execution control ${CAPABILITY_SCOPE_KEY} is not seeded`)
  if (
    head.executionState === posture.executionState &&
    head.admissionState === posture.admissionState
  ) {
    return
  }
  const generation = head.generation + 1
  // The head guard refuses an update stamped before the previous one; use the
  // wall clock so consecutive runs (and other suites) stay monotonic.
  const occurredAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(aiExecutionControlTransitions).values({
      controlId: head.controlId,
      generation,
      predecessorGeneration: head.generation,
      scopeKey: head.scopeKey,
      scopeKind: head.scopeKind,
      scopeValue: head.scopeValue,
      executionState: posture.executionState,
      admissionState: posture.admissionState,
      reasonCode: 'integration_test_transition',
      actorUserId,
      ticketReference: `ai-operation-fixture-${generation}`,
      candidateReleaseSha: null,
      occurredAt,
    })
    await tx
      .update(aiExecutionControlHeads)
      .set({
        generation,
        executionState: posture.executionState,
        admissionState: posture.admissionState,
        updatedAt: occurredAt,
      })
      .where(
        sql`${aiExecutionControlHeads.scopeKey} = ${CAPABILITY_SCOPE_KEY}
          AND ${aiExecutionControlHeads.generation} = ${head.generation}`,
      )
  })
}

/**
 * Install the organization, the property and an open reply-drafting control.
 * The seed leaves every capability killed and draining (fail closed); the
 * ledger reads the heads inside the admission transaction, so the fixture
 * opens this one for the run and `remove()` restores what it found.
 */
export async function installAiOperationFixture(
  input: AiOperationFixtureInput,
): Promise<AiOperationFixture> {
  const { db, organizationId, propertyId, actorUserId, now } = input

  const clear = async () => {
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, organizationId))
    await db
      .delete(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, organizationId))
    await db.delete(properties).where(eq(properties.id, propertyId))
    await deleteTestOrganizationsWithExecutor(db, [organizationId])
  }

  await clear()
  const [head] = await db
    .select({
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, CAPABILITY_SCOPE_KEY))
    .limit(1)
  if (
    !head ||
    (head.executionState !== 'enabled' && head.executionState !== 'killed') ||
    (head.admissionState !== 'accepting' && head.admissionState !== 'draining')
  ) {
    throw new Error(`AI execution control ${CAPABILITY_SCOPE_KEY} has an invalid state`)
  }
  const initialPosture: ControlPosture = {
    executionState: head.executionState,
    admissionState: head.admissionState,
  }
  await transitionCapabilityControl(db, actorUserId, {
    executionState: 'enabled',
    admissionState: 'accepting',
  })

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'AI operation fixture', ${organizationId}, ${now})
  `)
  await db.insert(properties).values({
    id: propertyId,
    organizationId,
    name: 'AI operation fixture property',
    slug: `ai-operation-fixture-${propertyId.slice(0, 8)}`,
    timezone: 'America/New_York',
    countryCode: 'US',
    profileVersion: 1,
    sourceEpoch: 1,
  })

  const heads = await db
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
    })
    .from(aiExecutionControlHeads)
  const control = (scopeKey: string) => {
    const found = heads.find((candidate) => candidate.scopeKey === scopeKey)
    if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    return found
  }
  const global = control('global')
  const provider = control(
    `provider:${AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion}`,
  )
  const capability = control(CAPABILITY_SCOPE_KEY)

  return Object.freeze({
    async seedOperation(seed: AiOperationSeed = {}) {
      const id = seed.id ?? randomUUID()
      await db.insert(aiOperations).values({
        id,
        idempotencyScope: `reply:${id}`,
        idempotencyKey: id,
        requestFingerprint: 'f'.repeat(64),
        sourceDigest: seed.sourceDigest ?? 'e'.repeat(64),
        sourceByteCount: seed.sourceByteCount ?? 20,
        command: AI_REPLY_OPERATION_PROFILE.command,
        capability: AI_REPLY_OPERATION_PROFILE.capability,
        organizationId,
        propertyId,
        actorUserId,
        systemPrincipal: null,
        reviewId: randomUUID(),
        sourceEpoch: 1,
        sourceRevision: 1,
        reviewedAtEpochMillis: now.getTime(),
        tone: 'professional',
        baseReplyStateRevision: 0,
        propertyProfileVersion: 1,
        providerDeploymentProfileVersion:
          AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
        operationProfileVersion: AI_REPLY_OPERATION_PROFILE.profileVersion,
        capabilityRuntimeProfileVersion:
          AI_REPLY_OPERATION_PROFILE.capabilityRuntimeProfileVersion,
        globalControlId: global.controlId,
        globalControlGeneration: global.generation,
        providerControlId: provider.controlId,
        providerControlGeneration: provider.generation,
        capabilityControlId: capability.controlId,
        capabilityControlGeneration: capability.generation,
        capabilityFences: {},
        state: seed.state ?? 'pending',
        executionAttempt: seed.executionAttempt ?? 0,
        executionPermitId: seed.executionPermitId ?? null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
      })
      return id
    },
    async remove() {
      await clear()
      await transitionCapabilityControl(db, actorUserId, initialPosture)
    },
  })
}
