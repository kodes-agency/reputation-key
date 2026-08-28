// LIF-01-T21 — the read behind `repairPartialOffboarding`.
//
// Every column read here is Identity-owned: `member`, `property_access_grant`
// and `user_organization_bindings`. The output carries identifiers, counts and
// one enum — no name, email or resource title — so an operator can act on a
// report without the report itself becoming tenant content.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  PARTIAL_OFFBOARDING_GRANT_REASON,
  type PartialOffboardingLookup,
  type PartialOffboardingObservation,
} from '../application/use-cases/repair-partial-offboarding'

const countOf = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const bindingStateOf = (value: unknown): PartialOffboardingObservation['bindingState'] =>
  value === 'active' || value === 'released' ? value : 'absent'

export const createPartialOffboardingLookup = (db: Database): PartialOffboardingLookup =>
  Object.freeze({
    async observe(input) {
      const rows = await db.execute(sql`
        SELECT
          (
            SELECT m.id FROM member AS m
            WHERE m."organizationId" = ${input.organizationId}
              AND m."userId" = ${input.userId}
            LIMIT 1
          ) AS member_id,
          (
            SELECT COUNT(*)::int FROM property_access_grant AS g
            WHERE g.organization_id = ${input.organizationId}
              AND g.user_id = ${input.userId}
              AND g.revoked_at IS NULL
          ) AS active_grants,
          (
            SELECT COUNT(*)::int FROM property_access_grant AS g
            WHERE g.organization_id = ${input.organizationId}
              AND g.user_id = ${input.userId}
              AND g.revoked_at IS NOT NULL
              AND g.revoke_reason = ${PARTIAL_OFFBOARDING_GRANT_REASON}
          ) AS offboarded_grants,
          (
            SELECT b.state FROM user_organization_bindings AS b
            WHERE b.organization_id = ${input.organizationId}
              AND b.user_id = ${input.userId}
            ORDER BY b.version DESC
            LIMIT 1
          ) AS binding_state
      `)
      const row = (rows.rows[0] ?? {}) as Record<string, unknown>
      return {
        organizationId: input.organizationId,
        userId: input.userId,
        memberId: typeof row.member_id === 'string' ? row.member_id : null,
        activeGrantCount: countOf(row.active_grants),
        offboardedGrantCount: countOf(row.offboarded_grants),
        bindingState: bindingStateOf(row.binding_state),
      }
    },

    /**
     * The candidate shape is exactly the crash signature: at least one grant
     * revoked by offboarding, no live grant left, and a membership row that
     * should no longer exist. Bounded and ordered so repeated sweeps are
     * deterministic rather than randomly sampled.
     */
    async listCandidates(input) {
      const rows = await db.execute(sql`
        SELECT g.organization_id, g.user_id
        FROM property_access_grant AS g
        INNER JOIN member AS m
          ON m."organizationId" = g.organization_id
         AND m."userId" = g.user_id
        WHERE g.revoked_at IS NOT NULL
          AND g.revoke_reason = ${PARTIAL_OFFBOARDING_GRANT_REASON}
        GROUP BY g.organization_id, g.user_id
        HAVING COUNT(*) FILTER (WHERE g.revoked_at IS NULL) = 0
        ORDER BY g.organization_id, g.user_id
        LIMIT ${input.limit}
      `)
      return rows.rows.map((row) => {
        const record = row as Record<string, unknown>
        return {
          organizationId: String(record.organization_id),
          userId: String(record.user_id),
        }
      })
    },
  })
