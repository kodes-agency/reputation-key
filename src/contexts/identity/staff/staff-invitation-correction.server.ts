import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db/index'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { identityMemberInvited } from '../domain/events'
import { staffAccountError, type StaffOnboarding } from '../domain/staff-account'
import type { StaffManagementStore } from './staff-management-store.port.server'

export const replaceStaffInvitation =
  (db: Database, clock: () => Date): StaffManagementStore['replaceInvitation'] =>
  async (input, spendBudget) =>
    db.transaction(async (tx) => {
      const { organizationId: org, participationId: participation } = input
      // Acceptance uses this participation fence too. Recheck after waiting for it.
      const invitations = await tx.execute(
        sql`SELECT id, status, email FROM invitation WHERE "organizationId" = ${org} AND "staffParticipationId" = ${participation} ORDER BY (id = (SELECT invitation_id FROM staff_onboardings WHERE organization_id = ${org} AND staff_participation_id = ${participation}::uuid)) DESC NULLS LAST, "createdAt" DESC, id DESC FOR UPDATE`,
      )
      const previous = invitations.rows[0]
      const people = await tx.execute(
        sql`SELECT p.staff_participant_id, p.property_id, p.personal_portal_id, p.display_name FROM staff_participations p WHERE p.organization_id = ${org} AND p.id = ${participation}::uuid AND p.status = 'active' AND p.ended_at IS NULL AND p.personal_portal_id IS NOT NULL FOR UPDATE`,
      )
      const person = people.rows[0]
      if (!person)
        throw staffAccountError(
          'participation_not_found',
          'This staff participation has ended.',
        )
      const links = await tx.execute(
        sql`SELECT id FROM staff_user_links WHERE organization_id = ${org} AND staff_participant_id = ${person.staff_participant_id}::uuid AND effective_to IS NULL`,
      )
      if (
        links.rows.length ||
        !previous ||
        !['pending', 'expired'].includes(String(previous.status)) ||
        String(previous.email).toLowerCase() !== input.oldEmail.toLowerCase()
      )
        throw staffAccountError(
          'operation_conflict',
          'Only an invitation that has not been accepted can change email.',
        )
      await spendBudget()
      await tx.execute(
        sql`UPDATE invitation SET status = 'canceled' WHERE id = ${previous.id} AND "organizationId" = ${org}`,
      )
      await tx.execute(
        sql`INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "staffParticipationId", "propertyIds", "inviterId", "createdAt") VALUES (${input.invitationId}, ${org}, ${input.email}, 'member', 'pending', ${new Date(clock().getTime() + 7 * 86400000)}, ${participation}, NULL, ${input.actorId}, ${clock()})`,
      )
      await tx.execute(
        sql`UPDATE staff_onboardings SET invitation_id = ${input.invitationId}, failure_code = NULL, updated_at = ${clock()} WHERE organization_id = ${org} AND staff_participation_id = ${participation}::uuid AND status = 'done'`,
      )
      await insertOutboxRow(
        tx,
        identityMemberInvited({
          organizationId: organizationId(org),
          userId: userId(input.actorId),
          invitationId: invitationId(input.invitationId),
          role: 'Member',
          occurredAt: clock(),
        }),
      )
      return {
        organizationId: org,
        invitationId: input.invitationId,
        email: input.email,
        staffParticipationId: participation,
        staffParticipantId: String(person.staff_participant_id),
        propertyId: String(person.property_id),
        portalId: String(person.personal_portal_id),
        displayName: String(person.display_name),
        requestedBy: input.actorId,
      } as StaffOnboarding
    })
