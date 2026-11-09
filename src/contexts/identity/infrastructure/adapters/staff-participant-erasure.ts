// Erasure of one Staff Participant inside one Organization, shared by the manual
// rights executor and the restore replayer so both leave the same rows.
//
// Attribution keeps pointing at the participant id (the foreign keys are
// RESTRICT), so the person is pseudonymised rather than deleted: the name and
// every contact detail go, the ids stay, and the participant reads as a neutral
// label. The login account goes with its sessions unless the person also
// belongs to another Organization; then only this Organization's membership is
// removed and the login stays for the other one.

import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

export const FORMER_STAFF_LABEL = 'Former staff member'
const ARCHIVE_REASON = 'Erased on request'
const ERASED_BY = 'rights-request'

export type StaffParticipantErasure = Readonly<{
  participants: number
  logins: number
  memberships: number
}>

const sha256Hex = (value: SQL) => sql`encode(sha256(convert_to(${value}, 'UTF8')), 'hex')`

const uuidList = (ids: ReadonlyArray<string>) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

const rowCount = (result: { rows: unknown[] }) => result.rows.length

/**
 * The Organization's participants a verified subject reference names, in id
 * order. The digest is computed in SQL so the identifier never leaves the
 * database. A reference matches the participant's own id digest, the digest of
 * the lower-cased email of a login linked to it, or of an onboarding address.
 */
export async function resolveStaffParticipantIds(
  tx: Tx,
  organizationId: string,
  subjectRef: string,
): Promise<ReadonlyArray<string>> {
  const result = await tx.execute(sql`
    SELECT p.id
    FROM staff_participants p
    WHERE p.organization_id = ${organizationId}
      AND (
        ${sha256Hex(sql`p.id::text`)} = ${subjectRef}
        OR EXISTS (
          SELECT 1
          FROM staff_user_links l
          JOIN "user" u ON u.id = l.user_id
          WHERE l.organization_id = p.organization_id
            AND l.staff_participant_id = p.id
            AND ${sha256Hex(sql`lower(u.email)`)} = ${subjectRef}
        )
        OR EXISTS (
          SELECT 1
          FROM staff_onboardings o
          WHERE o.organization_id = p.organization_id
            AND o.staff_participant_id = p.id
            AND o.email IS NOT NULL
            AND ${sha256Hex(sql`lower(o.email)`)} = ${subjectRef}
        )
      )
    ORDER BY p.id
  `)
  return (result.rows as Array<{ id: string }>).map(({ id }) => id)
}

/** Login ids linked to the participants, and how many of them also belong elsewhere. */
export async function staffParticipantLogins(
  tx: Tx,
  organizationId: string,
  participantIds: ReadonlyArray<string>,
): Promise<Readonly<{ all: ReadonlyArray<string>; kept: ReadonlyArray<string> }>> {
  if (participantIds.length === 0) return { all: [], kept: [] }
  const result = await tx.execute(sql`
    SELECT DISTINCT l.user_id AS id,
      (
        EXISTS (
          SELECT 1 FROM member m
          WHERE m."userId" = l.user_id AND m."organizationId" <> ${organizationId}
        )
        OR EXISTS (
          SELECT 1 FROM staff_user_links o
          WHERE o.user_id = l.user_id AND o.organization_id <> ${organizationId}
        )
      ) AS elsewhere
    FROM staff_user_links l
    WHERE l.organization_id = ${organizationId}
      AND l.staff_participant_id IN (${uuidList(participantIds)})
    ORDER BY l.user_id
  `)
  const rows = result.rows as Array<{ id: string; elsewhere: boolean }>
  return {
    all: rows.map(({ id }) => id),
    kept: rows.filter(({ elsewhere }) => elsewhere).map(({ id }) => id),
  }
}

const textList = (values: ReadonlyArray<string>) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )

async function pseudonymise(
  tx: Tx,
  organizationId: string,
  ids: ReadonlyArray<string>,
  at: Date,
): Promise<number> {
  const when = at.toISOString()
  const participants = await tx.execute(sql`
    UPDATE staff_participants
    SET display_name = ${FORMER_STAFF_LABEL},
        status = 'archived',
        archived_at = COALESCE(archived_at, ${when}::timestamptz),
        archive_reason = COALESCE(archive_reason, ${ARCHIVE_REASON}),
        revision = revision + 1,
        updated_at = ${when}::timestamptz
    WHERE organization_id = ${organizationId}
      AND id IN (${uuidList(ids)})
      AND (display_name <> ${FORMER_STAFF_LABEL} OR status <> 'archived')
    RETURNING id
  `)
  await tx.execute(sql`
    UPDATE staff_participations
    SET display_name = ${FORMER_STAFF_LABEL},
        user_id = NULL,
        status = 'archived',
        ended_at = COALESCE(ended_at, ${when}::timestamptz),
        archive_reason = COALESCE(archive_reason, ${ARCHIVE_REASON}),
        revision = revision + 1,
        updated_at = ${when}::timestamptz
    WHERE organization_id = ${organizationId}
      AND staff_participant_id IN (${uuidList(ids)})
      AND (display_name <> ${FORMER_STAFF_LABEL} OR status <> 'archived' OR user_id IS NOT NULL)
  `)
  await tx.execute(sql`
    UPDATE portal_responsibilities
    SET effective_to = GREATEST(${when}::timestamptz, effective_from + interval '1 millisecond'),
        end_reason = COALESCE(end_reason, ${ARCHIVE_REASON})
    WHERE organization_id = ${organizationId}
      AND effective_to IS NULL
      AND staff_participation_id IN (
        SELECT id FROM staff_participations
        WHERE organization_id = ${organizationId}
          AND staff_participant_id IN (${uuidList(ids)})
      )
  `)
  await tx.execute(sql`
    UPDATE staff_user_links
    SET effective_to = GREATEST(${when}::timestamptz, effective_from + interval '1 millisecond'),
        end_reason = COALESCE(end_reason, ${ARCHIVE_REASON})
    WHERE organization_id = ${organizationId}
      AND effective_to IS NULL
      AND staff_participant_id IN (${uuidList(ids)})
  `)
  await tx.execute(sql`
    UPDATE staff_onboardings
    SET email = NULL, display_name = NULL, updated_at = ${when}::timestamptz
    WHERE organization_id = ${organizationId}
      AND staff_participant_id IN (${uuidList(ids)})
      AND (email IS NOT NULL OR display_name IS NOT NULL)
  `)
  return rowCount(participants)
}

async function removeLogins(
  tx: Tx,
  organizationId: string,
  logins: ReadonlyArray<string>,
  kept: ReadonlyArray<string>,
  participantIds: ReadonlyArray<string>,
  at: Date,
): Promise<Pick<StaffParticipantErasure, 'logins' | 'memberships'>> {
  if (logins.length === 0) return { logins: 0, memberships: 0 }
  const when = at.toISOString()
  await tx.execute(sql`
    DELETE FROM invitation
    WHERE "organizationId" = ${organizationId}
      AND (
        "staffParticipationId" IN (
          SELECT id::text FROM staff_participations
          WHERE organization_id = ${organizationId}
            AND staff_participant_id IN (${uuidList(participantIds)})
        )
        OR lower(email) IN (
          SELECT lower(email) FROM "user" WHERE id IN (${textList(logins)})
        )
      )
  `)
  await tx.execute(sql`
    UPDATE property_access_grants
    SET status = 'revoked', revoked_at = ${when}::timestamptz, revoked_by = ${ERASED_BY}
    WHERE organization_id = ${organizationId}
      AND user_id IN (${textList(logins)})
      AND status = 'active'
  `)
  const memberships = await tx.execute(sql`
    DELETE FROM member
    WHERE "organizationId" = ${organizationId} AND "userId" IN (${textList(logins)})
    RETURNING id
  `)
  const gone = logins.filter((id) => !kept.includes(id))
  if (gone.length === 0) return { logins: 0, memberships: rowCount(memberships) }
  await tx.execute(sql`
    DELETE FROM verification
    WHERE identifier IN (SELECT email FROM "user" WHERE id IN (${textList(gone)}))
  `)
  await tx.execute(sql`DELETE FROM session WHERE "userId" IN (${textList(gone)})`)
  await tx.execute(sql`DELETE FROM account WHERE "userId" IN (${textList(gone)})`)
  const users = await tx.execute(sql`
    DELETE FROM "user" WHERE id IN (${textList(gone)}) RETURNING id
  `)
  return { logins: rowCount(users), memberships: rowCount(memberships) }
}

/**
 * Erase the named participants of one Organization. Convergent: a participant
 * already erased, or a login already gone, counts as nothing and changes
 * nothing, so a replay after a restore converges on the same rows.
 */
export async function eraseStaffParticipants(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    participantIds: ReadonlyArray<string>
    at: Date
  }>,
): Promise<StaffParticipantErasure> {
  const { organizationId, participantIds, at } = input
  if (participantIds.length === 0) return { participants: 0, logins: 0, memberships: 0 }
  const { all, kept } = await staffParticipantLogins(tx, organizationId, participantIds)
  const participants = await pseudonymise(tx, organizationId, participantIds, at)
  const removed = await removeLogins(tx, organizationId, all, kept, participantIds, at)
  return { participants, ...removed }
}
