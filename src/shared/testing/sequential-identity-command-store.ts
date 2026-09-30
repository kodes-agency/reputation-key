// Sequential identity command store — NON-transactional test fake (BQC-3.5).
// Lives in shared/testing (with the in-memory identity port) so
// application-zone tests can use it without importing the drizzle-backed
// atomic store (application must not import infrastructure). Applies the
// same operation order (state → outbox → emit) and the same guards against
// its own in-memory better-auth tables without a real transaction.
//
// Not for production — production must use createAtomicIdentityCommandStore
// (src/contexts/identity/infrastructure/identity-command-store.ts).

import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { isOwnerToken } from '#/shared/domain/roles'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import { identityError } from '#/contexts/identity/domain/errors'
import { invitationState } from '#/contexts/identity/domain/invitation-state'
import type {
  AcceptedInvitation,
  IdentityCommandStore,
} from '#/contexts/identity/application/ports/identity-command-store.port'

/** In-memory invitation row (mirrors the better-auth invitation table). */
export type StoredInvitation = Readonly<{
  id: string
  organizationId: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  propertyIds: string | null
  inviterId: string | null
  createdAt: Date
}>

/** In-memory member row (mirrors the better-auth member table). */
export type StoredMember = Readonly<{
  id: string
  organizationId: string
  userId: string
  email: string
  role: string
  createdAt: Date
}>

/** In-memory user row (mirrors the better-auth user table's verification). */
export type StoredUser = Readonly<{
  id: string
  email: string
  emailVerified: boolean
}>

/** In-memory organization row (mirrors the better-auth organization table). */
export type StoredOrganization = Readonly<{
  id: string
  name: string
  slug: string
  createdAt: Date
}>

export type SequentialIdentityCommandStore = IdentityCommandStore &
  Readonly<{
    seedInvitation: (row: StoredInvitation) => void
    seedMember: (row: StoredMember) => void
    seedOrganization: (row: StoredOrganization) => void
    /**
     * Seed a user row. `markEmailVerified` refuses a seeded user at another
     * address; an unseeded user is assumed to exist (a saga's provider stub
     * creates none) and is recorded in `verifiedUserIds`.
     */
    seedUser: (row: StoredUser) => void
    /** Register a custom role name that still exists (orgRole + policy). */
    seedCustomRole: (role: string) => void
    invitationById: (id: string) => StoredInvitation | null
    memberById: (id: string) => StoredMember | null
    organizationById: (id: string) => StoredOrganization | null
    userById: (id: string) => StoredUser | null
    readonly allInvitations: ReadonlyArray<StoredInvitation>
    readonly allMembers: ReadonlyArray<StoredMember>
    /** Users whose email an acceptance marked verified, in order. */
    readonly verifiedUserIds: ReadonlyArray<string>
  }>

const INVITATION_INACTIVE_MESSAGE =
  'This invitation is no longer active. Ask your Account Admin for a new one.'
const INVITATION_EXPIRED_MESSAGE =
  'This invitation has expired. Ask your Account Admin to resend it.'
const INVITATION_OTHER_ADDRESS_MESSAGE =
  'This invitation was sent to a different email address. Sign out and open the link again.'
const INVITATION_CONSUMED_MESSAGE = 'This invitation was already accepted or cancelled.'
const INELIGIBLE_ROLE_MESSAGE = 'This invitation is not eligible for beta manager access'

function parsePropertyIds(raw: string | null): ReadonlyArray<string> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

export function createSequentialIdentityCommandStore(deps: {
  outbox?: RecordedOutbox
}): SequentialIdentityCommandStore {
  const invitations = new Map<string, StoredInvitation>()
  const members = new Map<string, StoredMember>()
  const organizations = new Map<string, StoredOrganization>()
  const users = new Map<string, StoredUser>()
  const verifiedUserIds: string[] = []
  const customRoles = new Set<string>()

  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordAndEmit = outbox.record

  const countOwners = (organizationId: string): number =>
    [...members.values()].filter(
      (m) => m.organizationId === organizationId && isOwnerToken(m.role),
    ).length

  const assertAddressHasNoMembership = (email: string, organizationId: string) => {
    const memberships = [...members.values()].filter(
      (m) => m.email.toLowerCase() === email,
    )
    if (memberships.some((m) => m.organizationId === organizationId)) {
      throw identityError(
        'already_exists',
        'User is already a member of this organization',
      )
    }
    if (memberships.length > 0) {
      throw identityError(
        'organization_conflict',
        'This account already belongs to another Organization',
      )
    }
  }

  const openInvitationsFor = (email: string, now: Date) =>
    [...invitations.values()].flatMap((i) => {
      if (i.email.toLowerCase() !== email) return []
      const state = invitationState(i.status, i.expiresAt, now)
      return state === 'pending' || state === 'expired' ? [{ ...i, state }] : []
    })

  const markEmailVerified = (userId: string, email: string) => {
    const seeded = users.get(userId)
    if (seeded && seeded.email.toLowerCase() !== email) {
      throw identityError('registration_failed', 'Registration failed. Please try again.')
    }
    if (seeded) users.set(userId, { ...seeded, emailVerified: true })
    verifiedUserIds.push(userId)
  }

  return {
    validateInvitationRegistration: async (command) => {
      const inv = invitations.get(command.invitationId as string)
      if (!inv || inv.status !== 'pending' || inv.expiresAt <= command.now) {
        throw identityError('invitation_not_found', 'Invitation is not available')
      }
      if (inv.email.toLowerCase() !== command.email.toLowerCase()) {
        throw identityError('forbidden', 'Invitation is not addressed to this email')
      }
      if (!isBetaInteractiveMemberRoleToken(inv.role ?? 'member')) {
        throw identityError(
          'forbidden',
          'This invitation is not eligible for beta manager access',
        )
      }
    },

    inviteMember: async (command) => {
      if (!isBetaInteractiveMemberRoleToken(command.role)) {
        throw identityError(
          'forbidden',
          'Only beta manager roles can receive an account invitation',
        )
      }
      const email = command.email.toLowerCase()
      const organizationId = command.organizationId as string
      assertAddressHasNoMembership(email, organizationId)
      const open = openInvitationsFor(email, command.now)
      const mine = open.filter((i) => i.organizationId === organizationId)
      const theirs = open.filter((i) => i.organizationId !== organizationId)
      if (mine.some((i) => i.state === 'pending')) {
        throw identityError(
          'already_exists',
          'User is already invited to this organization',
        )
      }
      if (mine.length > 0) {
        throw identityError(
          'already_exists',
          'This email has an expired invitation. Use Resend to renew it.',
        )
      }
      if (theirs.some((i) => i.state === 'pending')) {
        throw identityError(
          'organization_conflict',
          'This email already has a pending invitation from another Organization',
        )
      }
      for (const lapsed of theirs) {
        if (lapsed.status === 'pending') {
          const { state: _state, ...row } = lapsed
          invitations.set(row.id, { ...row, status: 'expired' })
        }
      }
      invitations.set(command.invitationId as string, {
        id: command.invitationId as string,
        organizationId: command.organizationId as string,
        email,
        role: command.role,
        status: 'pending',
        expiresAt: command.expiresAt,
        propertyIds:
          command.propertyIds.length > 0 ? JSON.stringify(command.propertyIds) : null,
        inviterId: command.inviterId as string,
        createdAt: command.now,
      })
      await recordAndEmit(command.event)
    },

    acceptInvitation: async (command) => {
      const inv = invitations.get(command.invitationId as string)
      if (!inv) {
        throw identityError('invitation_not_found', 'Invitation not found')
      }
      const acceptorEmail = command.acceptorEmail.toLowerCase()
      if (inv.email.toLowerCase() !== acceptorEmail) {
        throw identityError('forbidden', INVITATION_OTHER_ADDRESS_MESSAGE)
      }
      const state = invitationState(inv.status, inv.expiresAt, command.now)
      if (state === 'expired') {
        throw identityError('invitation_expired', INVITATION_EXPIRED_MESSAGE)
      }
      if (state !== 'pending') {
        throw identityError('invitation_not_found', INVITATION_INACTIVE_MESSAGE)
      }
      const role = (inv.role ?? 'member').trim().toLowerCase()
      if (!isBetaInteractiveMemberRoleToken(role)) {
        invitations.set(inv.id, { ...inv, status: 'rejected' })
        throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
      }
      const existingMemberships = [...members.values()].filter(
        (candidate) => candidate.userId === (command.acceptorUserId as string),
      )
      if (
        existingMemberships.some(
          (candidate) => candidate.organizationId !== inv.organizationId,
        )
      ) {
        throw identityError(
          'organization_conflict',
          'This account already belongs to another Organization',
        )
      }
      if (existingMemberships.length > 0) {
        throw identityError(
          'already_exists',
          'User is already a member of this Organization',
        )
      }
      if (command.markEmailVerified === true) {
        markEmailVerified(command.acceptorUserId as string, acceptorEmail)
      }
      members.set(`member-${command.acceptorUserId as string}`, {
        id: `member-${command.acceptorUserId as string}`,
        organizationId: inv.organizationId,
        userId: command.acceptorUserId as string,
        email: inv.email,
        role,
        createdAt: command.now,
      })
      invitations.set(inv.id, { ...inv, status: 'accepted' })
      const accepted: AcceptedInvitation = {
        organizationId: toOrganizationId(inv.organizationId),
        propertyIds: parsePropertyIds(inv.propertyIds),
        inviterId: inv.inviterId ? toUserId(inv.inviterId) : null,
      }
      const fact = command.buildEvent(accepted)
      await recordAndEmit(fact)
      return accepted
    },

    renewInvitation: async (command) => {
      const inv = invitations.get(command.invitationId as string)
      if (!inv || inv.organizationId !== (command.organizationId as string)) {
        throw identityError('invitation_not_found', 'Invitation not found')
      }
      if (inv.status !== 'pending' && inv.status !== 'expired') {
        throw identityError('invitation_not_found', INVITATION_CONSUMED_MESSAGE)
      }
      const role = (inv.role ?? 'member').trim().toLowerCase()
      if (!isBetaInteractiveMemberRoleToken(role)) {
        throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
      }
      const email = inv.email.toLowerCase()
      assertAddressHasNoMembership(email, inv.organizationId)
      const live = openInvitationsFor(email, command.now).filter(
        (i) => i.id !== inv.id && i.state === 'pending',
      )
      if (live.some((i) => i.organizationId === inv.organizationId)) {
        throw identityError(
          'already_exists',
          'User is already invited to this organization',
        )
      }
      if (live.length > 0) {
        throw identityError(
          'organization_conflict',
          'This email already has a pending invitation from another Organization',
        )
      }
      invitations.set(inv.id, {
        ...inv,
        status: 'pending',
        expiresAt: command.expiresAt,
      })
      return {
        email: inv.email,
        role,
        propertyIds: parsePropertyIds(inv.propertyIds),
        expiresAt: command.expiresAt,
      }
    },

    cancelInvitation: async (command) => {
      const inv = invitations.get(command.invitationId as string)
      if (
        !inv ||
        inv.organizationId !== (command.organizationId as string) ||
        (inv.status !== 'pending' && inv.status !== 'expired')
      ) {
        throw identityError('invitation_not_found', 'Invitation not found')
      }
      invitations.set(inv.id, { ...inv, status: 'canceled' })
      await recordAndEmit(command.event)
    },

    removeMember: async (command) => {
      const target = members.get(command.memberId)
      if (!target || target.organizationId !== (command.organizationId as string)) {
        throw identityError('member_not_found', 'Member not found in this organization')
      }
      if (
        isOwnerToken(target.role) &&
        countOwners(command.organizationId as string) <= 1
      ) {
        throw identityError(
          'last_owner',
          'Cannot remove the last owner of the organization',
        )
      }
      members.delete(command.memberId)
      await recordAndEmit(command.event)
    },

    changeMemberRole: async (command) => {
      if (!isBetaInteractiveMemberRoleToken(command.newRole)) {
        throw identityError(
          'forbidden',
          'Only beta manager roles can be assigned to login accounts',
        )
      }
      const target = members.get(command.memberId)
      if (!target || target.organizationId !== (command.organizationId as string)) {
        throw identityError('member_not_found', 'Member not found in this organization')
      }
      if (
        isOwnerToken(target.role) &&
        !isOwnerToken(command.newRole) &&
        countOwners(command.organizationId as string) <= 1
      ) {
        throw identityError(
          'last_owner',
          'Cannot remove the last owner of the organization',
        )
      }
      members.set(command.memberId, { ...target, role: command.newRole })
      await recordAndEmit(command.event)
    },

    seedInvitation: (row) => {
      invitations.set(row.id, row)
    },
    seedMember: (row) => {
      members.set(row.id, row)
    },
    seedOrganization: (row) => {
      organizations.set(row.id, row)
    },
    seedCustomRole: (role) => {
      customRoles.add(role)
    },
    seedUser: (row) => {
      users.set(row.id, row)
    },
    invitationById: (id) => invitations.get(id) ?? null,
    memberById: (id) => members.get(id) ?? null,
    organizationById: (id) => organizations.get(id) ?? null,
    userById: (id) => users.get(id) ?? null,
    get allInvitations() {
      return [...invitations.values()]
    },
    get allMembers() {
      return [...members.values()]
    },
    get verifiedUserIds() {
      return [...verifiedUserIds]
    },
  }
}
