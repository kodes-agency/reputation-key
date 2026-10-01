// Identity context — invitation reads that join what the invitation row names.
//
// The invitation table is Better Auth's, and Identity owns it. These reads join
// the Organization name and the inviter's display name, which Better Auth's
// own list endpoints do not return.

import type { InvitationId, OrganizationId } from '#/shared/domain/ids'

/** One invitation, looked up by its id alone, for the anonymous link preview. */
export type InvitationPreviewRow = Readonly<{
  id: string
  organizationId: OrganizationId
  organizationName: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  /** user.name via invitation.inviterId; null when that user is gone. */
  inviterName: string | null
  propertyIds: ReadonlyArray<string>
  /** Whether any account already uses the invited address. */
  accountExists: boolean
}>

/** One open invitation of an Organization, for its Members page. */
export type OrganizationInvitationRow = Readonly<{
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  createdAt: Date
  inviterName: string | null
  propertyIds: ReadonlyArray<string>
}>

export type InvitationReadModel = Readonly<{
  findForPreview(id: InvitationId): Promise<InvitationPreviewRow | null>
  /** Stored status IN ('pending','expired'), newest first. */
  listOpenForOrganization(
    orgId: OrganizationId,
  ): Promise<ReadonlyArray<OrganizationInvitationRow>>
}>

/**
 * Property display names, supplied by composition from the Property public API.
 * Deleted or foreign Properties are absent from the result.
 */
export type PropertyNameLookup = (
  orgId: OrganizationId,
  ids: ReadonlyArray<string>,
) => Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>
