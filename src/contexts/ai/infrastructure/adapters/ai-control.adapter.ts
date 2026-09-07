import { inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiExecutionControlHeads } from '#/shared/db/schema'
import { deleteAiDraftsForControl } from '#/shared/ai-provider-control/ai-draft-purge'
import type {
  AiControlHead,
  AiControlPort,
  AiControlScope,
} from '../../application/ports/ai-control.port'

const scopeKey = (scope: AiControlScope): string => {
  switch (scope.kind) {
    case 'global':
      return 'global'
    case 'provider_deployment_profile':
      return `provider:${scope.providerDeploymentProfileVersion}`
    case 'capability':
      return `capability:${scope.capability}`
  }
}

function mapHead(row: typeof aiExecutionControlHeads.$inferSelect): AiControlHead {
  const scope: AiControlScope =
    row.scopeKind === 'global'
      ? { kind: 'global' }
      : row.scopeKind === 'provider_deployment_profile' && row.scopeValue !== null
        ? {
            kind: 'provider_deployment_profile',
            providerDeploymentProfileVersion: row.scopeValue,
          }
        : row.scopeKind === 'capability' &&
            (row.scopeValue === 'review_analysis' ||
              row.scopeValue === 'reply_drafting' ||
              row.scopeValue === 'property_trends')
          ? { kind: 'capability', capability: row.scopeValue }
          : (() => {
              throw new Error(`Invalid persisted AI control scope: ${row.scopeKey}`)
            })()
  return {
    scope,
    controlId: row.controlId,
    generation: row.generation,
    executionState: row.executionState as AiControlHead['executionState'],
    admissionState: row.admissionState as AiControlHead['admissionState'],
    updatedAtEpochMillis: row.updatedAt.getTime(),
  }
}

export const createAiControlAdapter = (db: Database): AiControlPort => {
  return {
    async readHeads(input) {
      const scopes: readonly AiControlScope[] = [
        { kind: 'global' },
        {
          kind: 'provider_deployment_profile',
          providerDeploymentProfileVersion: input.providerDeploymentProfileVersion,
        },
        { kind: 'capability', capability: input.capability },
      ]
      const keys = scopes.map(scopeKey)
      const rows = await db
        .select()
        .from(aiExecutionControlHeads)
        .where(inArray(aiExecutionControlHeads.scopeKey, keys))
      const byKey = new Map(rows.map((row) => [row.scopeKey, row]))
      return scopes.flatMap((scope) => {
        const row = byKey.get(scopeKey(scope))
        return row ? [mapHead(row)] : []
      })
    },

    async transition(input) {
      return db.transaction(async (tx) => {
        const key = scopeKey(input.scope)
        const providerDeploymentProfileVersion =
          input.scope.kind === 'provider_deployment_profile'
            ? input.scope.providerDeploymentProfileVersion
            : input.providerDeploymentProfileVersion
        if (
          input.scope.kind === 'provider_deployment_profile' &&
          input.providerDeploymentProfileVersion !== null &&
          input.providerDeploymentProfileVersion !== providerDeploymentProfileVersion
        ) {
          return null
        }
        const result = await tx.execute(sql`
          SELECT *
          FROM transition_ai_execution_control_v1(
            ${key},
            ${providerDeploymentProfileVersion},
            ${input.expectedControlId}::uuid,
            ${input.expectedGeneration},
            ${input.executionState},
            ${input.admissionState},
            ${input.reasonCode},
            ${input.actorUserId},
            ${input.ticketReference},
            ${input.candidateReleaseSha}
          )
        `)
        if (result.rows.length !== 1) return null
        const row = result.rows[0] as Readonly<Record<string, unknown>>
        const generation =
          typeof row.generation === 'string' ? Number(row.generation) : row.generation
        const updatedAt =
          row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
        if (
          row.scope_key !== key ||
          row.control_id !== input.expectedControlId ||
          !Number.isSafeInteger(generation) ||
          (generation as number) < 1 ||
          row.execution_state !== input.executionState ||
          row.admission_state !== input.admissionState ||
          !Number.isFinite(updatedAt.getTime())
        ) {
          return null
        }
        await deleteAiDraftsForControl(
          tx,
          input.scope.kind,
          input.scope.kind === 'global'
            ? null
            : input.scope.kind === 'capability'
              ? input.scope.capability
              : input.scope.providerDeploymentProfileVersion,
        )
        return Object.freeze({
          scope: input.scope,
          controlId: row.control_id as string,
          generation: generation as number,
          executionState: input.executionState,
          admissionState: input.admissionState,
          updatedAtEpochMillis: updatedAt.getTime(),
        })
      })
    },
  }
}
