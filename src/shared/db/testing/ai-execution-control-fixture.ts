// Test fixture: the AI execution control heads (global, provider, capability).
// An integration suite opens every scope for execution, reads the heads it
// stamps onto operations, and puts each scope back as it found it.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation/ai-operation-profiles'

export const AI_CONTROL_SCOPE_KEYS = [
  'global',
  `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
  'capability:review_analysis',
] as const

export type ControlScopeKey = (typeof AI_CONTROL_SCOPE_KEYS)[number]
export type ControlHead = Readonly<{
  scopeKey: ControlScopeKey
  controlId: string
  generation: number
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
}>
export type ControlPosture = Pick<ControlHead, 'executionState' | 'admissionState'>

export type ControlTransitionOptions = Readonly<{
  actorUserId: string
  /** Prefix of the transition's ticket reference; the scope and generation follow it. */
  ticketPrefix?: string
  /** Stamped on the transition and the head; defaults to the wall clock. */
  occurredAt?: Date
}>

const DEFAULT_TICKET_PREFIX = 'ai-execution-control-fixture'

export async function readControlHeads(db: Database): Promise<readonly ControlHead[]> {
  const rows = await db
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(inArray(aiExecutionControlHeads.scopeKey, [...AI_CONTROL_SCOPE_KEYS]))

  return AI_CONTROL_SCOPE_KEYS.map((scopeKey) => {
    const row = rows.find((candidate) => candidate.scopeKey === scopeKey)
    if (!row) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    if (
      (row.executionState !== 'enabled' && row.executionState !== 'killed') ||
      (row.admissionState !== 'accepting' && row.admissionState !== 'draining')
    ) {
      throw new Error(`AI execution control ${scopeKey} has an invalid posture`)
    }
    return {
      scopeKey,
      controlId: row.controlId,
      generation: row.generation,
      executionState: row.executionState,
      admissionState: row.admissionState,
    }
  })
}

export async function transitionControl(
  db: Database,
  scopeKey: string,
  posture: ControlPosture,
  options: ControlTransitionOptions,
): Promise<void> {
  const [head] = await db
    .select()
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, scopeKey))
    .limit(1)
  if (!head) throw new Error(`AI execution control ${scopeKey} is not seeded`)
  if (
    head.executionState === posture.executionState &&
    head.admissionState === posture.admissionState
  ) {
    return
  }

  const generation = head.generation + 1
  const occurredAt = options.occurredAt ?? new Date()
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
      actorUserId: options.actorUserId,
      ticketReference: `${options.ticketPrefix ?? DEFAULT_TICKET_PREFIX}-${scopeKey}-${generation}`,
      candidateReleaseSha: null,
      occurredAt,
    })
    const updated = await tx
      .update(aiExecutionControlHeads)
      .set({
        generation,
        executionState: posture.executionState,
        admissionState: posture.admissionState,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(aiExecutionControlHeads.scopeKey, scopeKey),
          eq(aiExecutionControlHeads.generation, head.generation),
        ),
      )
      .returning({ scopeKey: aiExecutionControlHeads.scopeKey })
    if (updated.length !== 1) throw new Error(`AI execution control ${scopeKey} changed`)
  })
}

export function requireControl(
  controls: readonly ControlHead[],
  scopeKey: ControlScopeKey,
): ControlHead {
  const control = controls.find((candidate) => candidate.scopeKey === scopeKey)
  if (!control) throw new Error(`AI execution control ${scopeKey} is not seeded`)
  return control
}

export type OpenAiExecutionControls = Readonly<{
  /** The heads as they stand once every scope is enabled and accepting. */
  heads: readonly ControlHead[]
  /** Puts every scope back to the posture it had before it was opened. */
  restore: () => Promise<void>
}>

/** Enables and opens every execution scope; call `restore` when the suite ends. */
export async function openAiExecutionControls(
  db: Database,
  options: ControlTransitionOptions,
): Promise<OpenAiExecutionControls> {
  const initial = await readControlHeads(db)
  for (const control of initial) {
    await transitionControl(
      db,
      control.scopeKey,
      { executionState: 'enabled', admissionState: 'accepting' },
      options,
    )
  }
  return {
    heads: await readControlHeads(db),
    restore: async () => {
      for (const control of initial) {
        await transitionControl(db, control.scopeKey, control, options)
      }
    },
  }
}

/** The control id and generation columns an operation row stamps from the three heads. */
export async function readOperationControlColumns(db: Database) {
  const heads = await readControlHeads(db)
  const global = requireControl(heads, AI_CONTROL_SCOPE_KEYS[0])
  const provider = requireControl(heads, AI_CONTROL_SCOPE_KEYS[1])
  const capability = requireControl(heads, AI_CONTROL_SCOPE_KEYS[2])
  return {
    globalControlId: global.controlId,
    globalControlGeneration: global.generation,
    providerControlId: provider.controlId,
    providerControlGeneration: provider.generation,
    capabilityControlId: capability.controlId,
    capabilityControlGeneration: capability.generation,
  }
}

/** The stop fence the current heads give an operation claimed now. */
export async function readCurrentStopFence(db: Database) {
  const heads = await readControlHeads(db)
  const global = requireControl(heads, AI_CONTROL_SCOPE_KEYS[0])
  const provider = requireControl(heads, AI_CONTROL_SCOPE_KEYS[1])
  const capability = requireControl(heads, AI_CONTROL_SCOPE_KEYS[2])
  return {
    globalControlId: global.controlId,
    globalGeneration: global.generation,
    providerControlId: provider.controlId,
    providerGeneration: provider.generation,
    capabilityControlId: capability.controlId,
    capabilityGeneration: capability.generation,
  }
}
