import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type CurrentUserParticipationAuthorityDatabase = Pick<Database, 'execute'>

export type CurrentUserParticipationAuthorityDecision =
  | Readonly<{
      allowed: true
      staffParticipantId: string
      staffParticipationId: string
    }>
  | Readonly<{
      allowed: false
      reason: 'link_denied' | 'participation_denied'
    }>

/**
 * Prove a login's canonical Staff link and exact Property participation inside
 * the caller's command transaction. Link is always locked before participation
 * so Staff mutations can use one stable lock order and revocation cannot race a
 * protected write. Ambiguous retained links fail closed.
 */
export async function decideCurrentUserParticipationAuthority(
  db: CurrentUserParticipationAuthorityDatabase,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    at: Date
  }>,
): Promise<CurrentUserParticipationAuthorityDecision> {
  const links = await db.execute(sql`
    SELECT id::text AS id, staff_participant_id::text AS staff_participant_id
    FROM staff_user_links
    WHERE organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND effective_from <= ${input.at}
      AND (effective_to IS NULL OR effective_to > ${input.at})
    ORDER BY id
    LIMIT 2
    FOR SHARE
  `)
  if (links.rows.length !== 1) {
    return { allowed: false, reason: 'link_denied' }
  }

  const staffParticipantId = links.rows[0]?.staff_participant_id
  if (typeof staffParticipantId !== 'string') {
    return { allowed: false, reason: 'link_denied' }
  }

  const participations = await db.execute(sql`
    SELECT id::text AS id
    FROM staff_participations
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND staff_participant_id = ${staffParticipantId}::uuid
      AND status = 'active'
      AND started_at <= ${input.at}
      AND (ended_at IS NULL OR ended_at > ${input.at})
    ORDER BY id
    LIMIT 2
    FOR SHARE
  `)
  const staffParticipationId = participations.rows[0]?.id
  if (participations.rows.length !== 1 || typeof staffParticipationId !== 'string') {
    return { allowed: false, reason: 'participation_denied' }
  }

  return {
    allowed: true,
    staffParticipantId,
    staffParticipationId,
  }
}
