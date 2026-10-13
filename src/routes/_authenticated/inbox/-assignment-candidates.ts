import type { Role } from '#/shared/domain/roles'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'

export type InboxAssignmentCandidate = Readonly<{
  userId: string
  role: Role | null
  name: string | null
  email: string
}>

/** The final per-property eligibility decision remains transaction-authoritative. */
export const toInboxAssignmentOptions = (
  members: ReadonlyArray<InboxAssignmentCandidate>,
) =>
  members
    .filter(({ role }) => role !== null && isBetaInteractiveRole(role))
    .map((member) => ({
      userId: member.userId,
      name: member.name?.trim() || member.email,
    }))
