// LIF-01-T19 — durable authority and receipts for permanent Property Erase.
//
// Every transition is a single UPDATE guarded by the expected `from` state, so
// two concurrent operators cannot both believe they crossed the irreversible
// boundary. The `ENABLE ALWAYS` trigger on `property_erase_authorities` then
// re-checks the same transition table, which means a direct-SQL operator gets
// the same refusal an application caller does.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import {
  propertyEraseError,
  propertyLifecycleStateForErase,
  type PropertyEraseState,
} from '../domain/property-erase'
import type {
  PropertyEraseAuthority,
  PropertyEraseCommandStore,
  PropertyEraseConfirmInput,
  PropertyEraseContextReceipt,
  PropertyErasePreviewInput,
  PropertyEraseRequestInput,
  PropertyEraseTransitionInput,
} from '../application/ports/property-erase-command-store.port'
import type {
  PropertyEraseContext,
  PropertyEraseInventoryEntry,
} from '../application/ports/property-erase-contributor.port'

type AuthorityRow = Readonly<{
  id: string
  organization_id: string
  property_id: string
  state: PropertyEraseState
  requested_by_user_id: string
  identity_verification_ref: string
  support_operator_id: string
  support_authorization_ref: string
  retention_preview_ref: string | null
  export_evidence_ref: string | null
  inventory_revision: number
  inventory_digest: string | null
  confirmation_digest: string | null
  grace_expires_at: string | Date | null
  requested_at: string | Date
  state_changed_at: string | Date
}>

function toAuthority(row: AuthorityRow): PropertyEraseAuthority {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    state: row.state,
    requestedByUserId: row.requested_by_user_id,
    identityVerificationRef: row.identity_verification_ref,
    supportOperatorId: row.support_operator_id,
    supportAuthorizationRef: row.support_authorization_ref,
    ...(row.retention_preview_ref
      ? { retentionPreviewRef: row.retention_preview_ref }
      : {}),
    ...(row.export_evidence_ref ? { exportEvidenceRef: row.export_evidence_ref } : {}),
    inventoryRevision: Number(row.inventory_revision),
    ...(row.inventory_digest ? { inventoryDigest: row.inventory_digest } : {}),
    ...(row.confirmation_digest ? { confirmationDigest: row.confirmation_digest } : {}),
    ...(row.grace_expires_at ? { graceExpiresAt: new Date(row.grace_expires_at) } : {}),
    requestedAt: new Date(row.requested_at),
    stateChangedAt: new Date(row.state_changed_at),
  }
}

const firstAuthority = (
  rows: readonly unknown[],
  what: string,
): PropertyEraseAuthority => {
  const row = rows[0] as AuthorityRow | undefined
  if (!row) {
    throw propertyEraseError('invalid_transition', `${what} did not apply`)
  }
  return toAuthority(row)
}

/**
 * `db` for the ordinary command path; a caller inside an existing transaction
 * (the advance job) passes its own `Tx` to `withTx`.
 */
export const createPropertyEraseCommandStore = (
  db: Database,
): PropertyEraseCommandStore & {
  withTx(tx: Tx): PropertyEraseCommandStore
} => build(db as unknown as Tx, db)

function build(
  runner: Tx,
  db: Database,
): PropertyEraseCommandStore & {
  withTx(tx: Tx): PropertyEraseCommandStore
} {
  const request = async (
    input: PropertyEraseRequestInput,
  ): Promise<PropertyEraseAuthority> => {
    const result = await runner.execute(sql`
      INSERT INTO property_erase_authorities (
        organization_id, property_id, state, requested_by_user_id,
        identity_verification_ref, support_operator_id, support_authorization_ref,
        evidence_ref, correlation_id, requested_at, state_changed_at
      ) VALUES (
        ${input.organizationId}, ${input.propertyId}::uuid, 'requested',
        ${input.requestedByUserId}, ${input.identityVerificationRef},
        ${input.supportOperatorId}, ${input.supportAuthorizationRef},
        ${input.evidenceRef}, ${input.correlationId},
        ${input.requestedAt.toISOString()}::timestamptz,
        ${input.requestedAt.toISOString()}::timestamptz
      )
      RETURNING *
    `)
    return firstAuthority(result.rows, 'erase request')
  }

  const load = async (
    authorityId: string,
    organizationId: string,
  ): Promise<PropertyEraseAuthority | null> => {
    const result = await runner.execute(sql`
      SELECT * FROM property_erase_authorities
      WHERE id = ${authorityId}::uuid
        AND organization_id = ${organizationId}
    `)
    const row = result.rows[0] as AuthorityRow | undefined
    return row ? toAuthority(row) : null
  }

  /**
   * Exactly one Property per pass. An unbounded sweep across an Organization's
   * Properties would turn one reviewed authorization into many erasures.
   *
   * A `purging` authority always wins: work already past the irreversible
   * boundary must finish before another Property is allowed to start.
   */
  const nextAdvanceable = async (now: Date): Promise<PropertyEraseAuthority | null> => {
    const result = await runner.execute(sql`
      SELECT * FROM property_erase_authorities
      WHERE state = 'purging'
         OR state = 'confirmed'
         OR (state = 'purge_pending' AND grace_expires_at <= ${now.toISOString()}::timestamptz)
      ORDER BY (state = 'purging') DESC, state_changed_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `)
    const row = result.rows[0] as AuthorityRow | undefined
    return row ? toAuthority(row) : null
  }

  const recordPreview = async (
    input: PropertyErasePreviewInput,
  ): Promise<PropertyEraseAuthority> => {
    const result = await runner.execute(sql`
      UPDATE property_erase_authorities
      SET state = 'previewed',
          inventory_revision = ${input.inventoryRevision},
          inventory_digest = ${input.inventoryDigest},
          retention_preview_ref = ${input.retentionPreviewRef},
          export_evidence_ref = COALESCE(${input.exportEvidenceRef ?? null}, export_evidence_ref),
          state_changed_at = ${input.occurredAt.toISOString()}::timestamptz,
          updated_at = ${input.occurredAt.toISOString()}::timestamptz
      WHERE id = ${input.authorityId}::uuid
        AND organization_id = ${input.organizationId}
        AND state IN ('requested', 'previewed')
        AND inventory_revision < ${input.inventoryRevision}
      RETURNING *
    `)
    return firstAuthority(result.rows, 'erase preview')
  }

  const confirm = async (
    input: PropertyEraseConfirmInput,
  ): Promise<PropertyEraseAuthority> => {
    const result = await runner.execute(sql`
      UPDATE property_erase_authorities
      SET state = 'confirmed',
          confirmation_digest = ${input.confirmationDigest},
          confirmed_at = ${input.occurredAt.toISOString()}::timestamptz,
          grace_expires_at = ${input.graceExpiresAt.toISOString()}::timestamptz,
          state_changed_at = ${input.occurredAt.toISOString()}::timestamptz,
          updated_at = ${input.occurredAt.toISOString()}::timestamptz
      WHERE id = ${input.authorityId}::uuid
        AND organization_id = ${input.organizationId}
        AND state = 'previewed'
        AND inventory_revision = ${input.inventoryRevision}
      RETURNING *
    `)
    return firstAuthority(result.rows, 'erase confirmation')
  }

  /**
   * Every other transition. The `from` guard is what makes a concurrent second
   * caller lose rather than double-cross the irreversible boundary; the
   * lifecycle column on `properties` moves in the same statement pair so the
   * Property never advertises a state its authority has not reached.
   */
  const transition = async (
    input: PropertyEraseTransitionInput,
  ): Promise<PropertyEraseAuthority> => {
    const at = input.occurredAt.toISOString()
    const result = await runner.execute(sql`
      UPDATE property_erase_authorities
      SET state = ${input.to},
          purge_started_at = CASE WHEN ${input.to} = 'purging' THEN ${at}::timestamptz ELSE purge_started_at END,
          purged_at = CASE WHEN ${input.to} = 'purged' THEN ${at}::timestamptz ELSE purged_at END,
          cancelled_at = CASE WHEN ${input.to} = 'cancelled' THEN ${at}::timestamptz ELSE cancelled_at END,
          cancel_reason_code = COALESCE(${input.reasonCode ?? null}, cancel_reason_code),
          state_changed_at = ${at}::timestamptz,
          updated_at = ${at}::timestamptz
      WHERE id = ${input.authorityId}::uuid AND state = ${input.from}
      RETURNING *
    `)
    const authority = firstAuthority(
      result.rows,
      `erase transition ${input.from} -> ${input.to}`,
    )
    if (input.to !== 'cancelled') {
      await runner.execute(sql`
        UPDATE properties
        SET lifecycle_state = ${propertyLifecycleStateForErase(input.to)},
            lifecycle_state_changed_at = ${at}::timestamptz,
            updated_at = ${at}::timestamptz
        WHERE id = ${authority.propertyId}::uuid
          AND organization_id = ${authority.organizationId}
      `)
    }
    return authority
  }

  const recordContextReceipt = async (
    receipt: PropertyEraseContextReceipt,
  ): Promise<void> => {
    await runner.execute(sql`
      INSERT INTO property_erase_context_receipts (
        authority_id, context, phase, outcome, erased_row_count, evidence_ref, occurred_at
      ) VALUES (
        ${receipt.authorityId}::uuid, ${receipt.context}, ${receipt.phase},
        ${receipt.outcome}, ${receipt.erasedRowCount}, ${receipt.evidenceRef},
        ${receipt.occurredAt.toISOString()}::timestamptz
      )
      ON CONFLICT (authority_id, context, phase) DO NOTHING
    `)
  }

  const completedContexts = async (
    authorityId: string,
    phase: 'inventory' | 'purge',
  ): Promise<readonly PropertyEraseContext[]> => {
    const result = await runner.execute(sql`
      SELECT context FROM property_erase_context_receipts
      WHERE authority_id = ${authorityId}::uuid AND phase = ${phase}
      ORDER BY context
    `)
    return (result.rows as unknown as readonly { context: PropertyEraseContext }[]).map(
      (row) => row.context,
    )
  }

  const readInventory = async (
    authorityId: string,
  ): Promise<readonly PropertyEraseInventoryEntry[]> => {
    const result = await runner.execute(sql`
      SELECT context, erased_row_count FROM property_erase_context_receipts
      WHERE authority_id = ${authorityId}::uuid AND phase = 'inventory'
      ORDER BY context
    `)
    return (
      result.rows as unknown as readonly {
        context: PropertyEraseContext
        erased_row_count: number
      }[]
    ).map((row) => ({
      context: row.context,
      table: `${row.context}:*`,
      rowCount: Number(row.erased_row_count),
    }))
  }

  return {
    request,
    load,
    nextAdvanceable,
    recordPreview,
    confirm,
    transition,
    recordContextReceipt,
    completedContexts,
    readInventory,
    withTx: (tx: Tx) => build(tx, db),
  }
}
