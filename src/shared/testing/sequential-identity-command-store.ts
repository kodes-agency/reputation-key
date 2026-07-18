// Sequential identity command store — NON-transactional test fake (BQC-3.5).
// Lives in shared/testing (with the in-memory identity port) so
// application-zone tests can use it without importing the drizzle-backed
// atomic store (application must not import infrastructure). Applies the
// same operation order (state → outbox → emit) and the same guards against
// its own in-memory better-auth tables without a real transaction.
//
// Not for production — production must use createAtomicIdentityCommandStore
// (src/contexts/identity/infrastructure/identity-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { isOwnerToken } from '#/shared/domain/roles'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '#/contexts/identity/domain/errors'
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
    /** Register a custom role name that still exists (orgRole + policy). */
    seedCustomRole: (role: string) => void
    invitationById: (id: string) => StoredInvitation | null
    memberById: (id: string) => StoredMember | null
    organizationById: (id: string) => StoredOrganization | null
    readonly allInvitations: ReadonlyArray<StoredInvitation>
    readonly allMembers: ReadonlyArray<StoredMember>
  }>

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after sequential store state write',
    )
  }
}

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
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): SequentialIdentityCommandStore {
  const invitations = new Map<string, StoredInvitation>()
  const members = new Map<string, StoredMember>()
  const organizations = new Map<string, StoredOrganization>()
  const customRoles = new Set<string>()

  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  const countOwners = (organizationId: string): number =>
    [...members.values()].filter(
      (m) => m.organizationId === organizationId && isOwnerToken(m.role),
    ).length

  return {
    inviteMember: async (command) => {
      const email = command.email.toLowerCase()
      const alreadyMember = [...members.values()].some(
        (m) =>
          m.organizationId === (command.organizationId as string) &&
          m.email.toLowerCase() === email,
      )
      if (alreadyMember) {
        throw identityError(
          'already_exists',
          'User is already a member of this organization',
        )
      }
      const alreadyInvited = [...invitations.values()].some(
        (i) =>
          i.organizationId === (command.organizationId as string) &&
          i.email === email &&
          i.status === 'pending',
      )
      if (alreadyInvited) {
        throw identityError(
          'already_exists',
          'User is already invited to this organization',
        )
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
      if (inv.email.toLowerCase() !== command.acceptorEmail.toLowerCase()) {
        throw identityError('forbidden', 'Invitation is not addressed to this user')
      }
      if (inv.status !== 'pending') {
        throw identityError(
          'invitation_not_found',
          `Invitation is no longer pending (status: ${inv.status})`,
        )
      }
      if (inv.expiresAt <= command.now) {
        throw identityError('invitation_not_found', 'Invitation has expired')
      }
      const role = (inv.role ?? 'member').trim().toLowerCase()
      if (!['owner', 'admin', 'member'].includes(role) && !customRoles.has(role)) {
        invitations.set(inv.id, { ...inv, status: 'rejected' })
        throw identityError('forbidden', 'Invitation role is no longer available')
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
      }
      const fact = command.buildEvent(accepted)
      await recordAndEmit(fact)
      return accepted
    },

    cancelInvitation: async (command) => {
      const inv = invitations.get(command.invitationId as string)
      if (!inv || inv.organizationId !== (command.organizationId as string)) {
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

    registerOrganization: async (command) => {
      const slugTaken = [...organizations.values()].some((o) => o.slug === command.slug)
      if (slugTaken) {
        throw identityError(
          'already_exists',
          'An organization with this slug already exists',
        )
      }
      organizations.set(command.organizationId as string, {
        id: command.organizationId as string,
        name: command.organizationName,
        slug: command.slug,
        createdAt: command.now,
      })
      members.set(`member-${command.ownerId as string}`, {
        id: `member-${command.ownerId as string}`,
        organizationId: command.organizationId as string,
        userId: command.ownerId as string,
        email: '',
        role: 'owner',
        createdAt: command.now,
      })
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
    invitationById: (id) => invitations.get(id) ?? null,
    memberById: (id) => members.get(id) ?? null,
    organizationById: (id) => organizations.get(id) ?? null,
    get allInvitations() {
      return [...invitations.values()]
    },
    get allMembers() {
      return [...members.values()]
    },
  }
}
