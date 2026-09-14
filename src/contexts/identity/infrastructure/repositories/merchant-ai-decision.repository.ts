// Merchant AI decision deferral store.
//
// One row per Property in `merchant_ai_decision_deferrals`. The defer command
// serializes with enable through the Property row lock both take first: a
// deferral is only written after the locked authorization head was read as
// not enabled, and enable deletes the row inside its own transaction, so a
// deferral never stands beside an enabled head.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  MerchantAiDecisionDeferral,
  MerchantAiDecisionDeferralStore,
} from '../../application/use-cases/merchant-ai-decision-deferral'
import { decideMemberPropertyAuthority } from './member-property-authority'

type Row = Record<string, unknown>
type Executor = Pick<Database, 'execute'>

function readText(row: Row, column: string): string {
  const value = row[column]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid Merchant AI decision deferral ${column}`)
  }
  return value
}

function readInstant(row: Row, column: string): Date {
  const value = row[column]
  const instant =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!instant || Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid Merchant AI decision deferral ${column}`)
  }
  return instant
}

async function findMerchantAiDecisionDeferral(
  db: Executor,
  input: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<MerchantAiDecisionDeferral | null> {
  const result = await db.execute(sql`
    SELECT organization_id, property_id::text AS property_id, deferred_by, deferred_at
    FROM merchant_ai_decision_deferrals
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
    LIMIT 1
  `)
  const row = result.rows[0] as Row | undefined
  if (!row) return null
  return Object.freeze({
    organizationId: readText(row, 'organization_id'),
    propertyId: readText(row, 'property_id'),
    deferredBy: readText(row, 'deferred_by'),
    deferredAt: readInstant(row, 'deferred_at'),
  })
}

/** Remove a Property's standing deferral inside the caller's transaction. */
export async function deleteMerchantAiDecisionDeferral(
  tx: Executor,
  input: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM merchant_ai_decision_deferrals
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
  `)
}

export const createMerchantAiDecisionDeferralStore = (
  db: Database,
): MerchantAiDecisionDeferralStore => ({
  findDecisionDeferral: (input) => findMerchantAiDecisionDeferral(db, input),

  deferDecision: (input) =>
    db.transaction(async (tx) => {
      // Same first lock as the enable transaction, so the two serialize.
      const property = await tx.execute(sql`
        SELECT id
        FROM properties
        WHERE organization_id = ${input.organizationId}
          AND id = ${input.propertyId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `)
      if (property.rows.length === 0) return { outcome: 'property_not_found' } as const

      const membership = await tx.execute(sql`
        SELECT role
        FROM member
        WHERE "organizationId" = ${input.organizationId}
          AND "userId" = ${input.actorUserId}
        FOR SHARE
      `)
      const memberRole = (membership.rows[0] as Row | undefined)?.role
      if (typeof memberRole !== 'string' || memberRole.length === 0) {
        return { outcome: 'authority_denied' } as const
      }
      const authority = await decideMemberPropertyAuthority(tx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.actorUserId,
        memberRole,
        permission: 'ai.manage',
        at: input.now,
      })
      if (!authority.allowed) return { outcome: 'authority_denied' } as const

      const head = await tx.execute(sql`
        SELECT state
        FROM merchant_ai_enablement
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}::uuid
        FOR SHARE
      `)
      if ((head.rows[0] as Row | undefined)?.state === 'enabled') {
        return { outcome: 'already_enabled' } as const
      }

      // The first "not now" since the last enable stands; a repeat keeps it.
      await tx.execute(sql`
        INSERT INTO merchant_ai_decision_deferrals (
          property_id, organization_id, deferred_by, deferred_at
        ) VALUES (
          ${input.propertyId}::uuid, ${input.organizationId},
          ${input.actorUserId}, ${input.now}
        )
        ON CONFLICT (property_id) DO NOTHING
      `)
      const deferral = await findMerchantAiDecisionDeferral(tx, input)
      if (!deferral) throw new Error('Merchant AI decision deferral was not recorded')
      return { outcome: 'deferred', deferral } as const
    }),
})
