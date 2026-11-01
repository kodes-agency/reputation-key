import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { identityError } from '../domain/errors'

/** Joins the acceptance transaction: membership and login link commit together. */
export async function linkStaffInvitation(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    participationId: string
    userId: string
    actorId: string
    at: Date
  }>,
) {
  const rows = await tx.execute(sql`
    SELECT p.staff_participant_id AS id
    FROM staff_participations p
    JOIN staff_participants person ON person.organization_id = p.organization_id AND person.id = p.staff_participant_id
    WHERE p.organization_id = ${input.organizationId} AND p.id = ${input.participationId}::uuid
      AND p.status = 'active' AND p.ended_at IS NULL AND p.personal_portal_id IS NOT NULL AND person.status = 'active'
    FOR UPDATE OF p, person
  `)
  const participant = rows.rows[0] as { id: string } | undefined
  if (!participant) {
    throw identityError(
      'forbidden',
      'This staff invitation has ended. Ask your manager to add you again',
    )
  }
  const links = await tx.execute(sql`
    SELECT id, user_id, staff_participant_id FROM staff_user_links
    WHERE organization_id = ${input.organizationId} AND effective_to IS NULL
      AND (user_id = ${input.userId} OR staff_participant_id = ${participant.id}::uuid)
    FOR UPDATE
  `)
  if (
    links.rows.some(
      (row) =>
        row.user_id !== input.userId || row.staff_participant_id !== participant.id,
    )
  ) {
    throw identityError(
      'forbidden',
      'This account is linked to a different staff record. Ask your manager for help',
    )
  }
  if (links.rows.length === 0) {
    await tx.execute(sql`
      INSERT INTO staff_user_links (id, organization_id, staff_participant_id, user_id, effective_from, created_by)
      VALUES (gen_random_uuid(), ${input.organizationId}, ${participant.id}::uuid, ${input.userId}, ${input.at}, ${input.actorId})
    `)
  }
}
