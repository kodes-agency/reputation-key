// Identity context — the invitation link's preview (anonymous read).
//
// The invitation id is a bearer secret already mailed to the invitee. The
// preview returns only what that email states (Organization, inviter, role,
// Properties, expiry, the invited address) plus whether the address has an
// account, so the link can route to sign-up or sign-in. An id that is not a
// usable beta invitation — unknown, rejected, an unknown status, a non-beta
// role — returns one identical shape, so ids cannot be probed by the copy.

import type { InvitationId } from '#/shared/domain/ids'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { betaInvitationRole, invitationState } from '../../domain/invitation-state'
import type {
  InvitationReadModel,
  PropertyNameLookup,
} from '../ports/invitation-read-model.port'
import { resolveInvitationProperties } from '../invitation-properties'

export type InvitationPreview =
  | Readonly<{
      state: 'pending'
      invitationId: string
      organizationName: string
      inviterName: string | null
      role: BetaInteractiveRole
      propertyNames: ReadonlyArray<string>
      email: string
      expiresAt: Date
      accountExists: boolean
    }>
  | Readonly<{
      state: 'expired' | 'canceled' | 'accepted'
      organizationName: string
      inviterName: string | null
    }>
  | Readonly<{ state: 'unavailable' }>

export type GetInvitationPreviewDeps = Readonly<{
  invitations: InvitationReadModel
  propertyNames: PropertyNameLookup
  clock: () => Date
}>

export type GetInvitationPreview = (id: InvitationId) => Promise<InvitationPreview>

const unavailable = (): InvitationPreview => ({ state: 'unavailable' })

export const getInvitationPreview =
  (deps: GetInvitationPreviewDeps): GetInvitationPreview =>
  async (id) => {
    const row = await deps.invitations.findForPreview(id)
    if (!row) return unavailable()
    const role = betaInvitationRole(row.role)
    if (!role) return unavailable()

    const state = invitationState(row.status, row.expiresAt, deps.clock())
    if (state === 'expired' || state === 'canceled' || state === 'accepted') {
      return {
        state,
        organizationName: row.organizationName,
        inviterName: row.inviterName,
      }
    }
    if (state !== 'pending') return unavailable()

    const properties =
      role === 'AccountAdmin'
        ? []
        : await resolveInvitationProperties(
            deps.propertyNames,
            row.organizationId,
            row.propertyIds,
          )
    return {
      state: 'pending',
      invitationId: row.id,
      organizationName: row.organizationName,
      inviterName: row.inviterName,
      role,
      propertyNames: properties.map((property) => property.name),
      email: row.email,
      expiresAt: row.expiresAt,
      accountExists: row.accountExists,
    }
  }
