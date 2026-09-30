// Platform operator console store (ADR 0063) over the Identity-owned tables
// organization, member, invitation and organization_lifecycle_authority, plus
// the `audit_logs` rows it writes.
//
// Provisioning is ONE transaction: a per-slug advisory lock and slug check,
// the Organization insert (its insert trigger writes the lifecycle authority
// row), then the ordinary AccountAdmin invitation command — the same guards,
// row and `identity.member.invited` fact as any invitation — running in a
// savepoint of this transaction. A refused invitation therefore rolls the
// Organization back too, and no Organization is ever left half-made. The
// operator never gets a member row.
//
// Every change (provision, invite, resend, cancel) commits one `audit_logs`
// row in the same transaction: the Organization, the operator and the action.
// It is the durable record of who made the change — log lines, spans and the
// canceled fact name no one — and it carries ids only, never an address.

import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import { invitation, member, organization } from '#/shared/db/schema/auth'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { trace } from '#/shared/observability/trace'
import { isOwnerToken } from '#/shared/domain/roles'
import {
  invitationId as toInvitationId,
  organizationId as toOrganizationId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import {
  ORGANIZATION_LIFECYCLE_STATES,
  type OrganizationLifecycleState,
} from '../domain/organization-lifecycle'
import type {
  CancelInvitationCommand,
  IdentityCommandStore,
  InviteMemberCommand,
  RenewInvitationCommand,
} from '../application/ports/identity-command-store.port'
import type {
  OrganizationAdministration,
  PlatformAdminInvitationRow,
  PlatformOrganizationRow,
  PlatformOrganizationStore,
  ProvisionOrganizationCommand,
} from '../application/ports/platform-organization-store.port'
import { createAtomicIdentityCommandStore } from './identity-command-store'

const SLUG_TAKEN_MESSAGE = 'Another Organization already uses this slug'
/** Better Auth's unique index on organization.slug. */
const SLUG_UNIQUE_INDEX = 'organization_slug_key'

/** Open invitation statuses: the ones Resend and Cancel still act on. */
const OPEN_INVITATION_STATUSES = ['pending', 'expired'] as const

/** One `audit_logs` row per console change: who, on which Organization, what. */
type OperatorAudit = Readonly<{
  organizationId: OrganizationId
  operatorUserId: UserId
  action:
    | 'platform.organization_provisioned'
    | 'platform.admin_invited'
    | 'platform.admin_invitation_resent'
    | 'platform.admin_invitation_canceled'
  resourceType: 'organization' | 'invitation'
  resourceId: string
  /** Ids only: the row never carries an address. */
  details?: Readonly<Record<string, string>>
  at: Date
}>

async function writeOperatorAudit(tx: Tx, audit: OperatorAudit): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: audit.organizationId as string,
    userId: audit.operatorUserId as string,
    action: audit.action,
    resourceType: audit.resourceType,
    resourceId: audit.resourceId,
    details: audit.details ?? null,
    createdAt: audit.at,
    updatedAt: audit.at,
  })
}

type OrganizationHead = Readonly<{
  id: string
  name: string
  slug: string
  createdAt: Date
  state: string
}>

/** An open AccountAdmin invitation of an Organization that has no AccountAdmin. */
type AdminInvitation = Readonly<{
  id: string
  organizationId: string
  email: string
  status: string
  expiresAt: Date
}>

type MemberCounts = Readonly<{ memberCount: number; accountAdminCount: number }>

const NO_MEMBERS: MemberCounts = { memberCount: 0, accountAdminCount: 0 }

function lifecycleState(raw: string): OrganizationLifecycleState {
  const state = ORGANIZATION_LIFECYCLE_STATES.find((known) => known === raw)
  if (!state) throw new Error(`Unknown organization lifecycle state: ${raw}`)
  return state
}

/** True when the error, or a cause drizzle wrapped it in, is the slug index's. */
function violatesSlugUniqueness(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false
  const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown }
  return (
    (candidate.code === '23505' && candidate.constraint === SLUG_UNIQUE_INDEX) ||
    violatesSlugUniqueness(candidate.cause, depth + 1)
  )
}

const headColumns = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  createdAt: organization.createdAt,
  state: organizationLifecycleAuthority.state,
}

/** The SQL twin of isOwnerToken: the comma-separated role names 'owner'. */
const invitationNamesOwner = sql`'owner' = ANY (
  SELECT btrim(lower(token)) FROM unnest(string_to_array(${invitation.role}, ',')) AS token
)`

/** Members and AccountAdmins per Organization, from one grouped read. */
async function countMembers(
  db: Database,
  organizationIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, MemberCounts>> {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      role: member.role,
      members: sql<number>`count(*)::int`,
    })
    .from(member)
    .where(inArray(member.organizationId, [...organizationIds]))
    .groupBy(member.organizationId, member.role)
  const counts = new Map<string, MemberCounts>()
  for (const row of rows) {
    const current = counts.get(row.organizationId) ?? NO_MEMBERS
    counts.set(row.organizationId, {
      memberCount: current.memberCount + row.members,
      accountAdminCount:
        current.accountAdminCount + (isOwnerToken(row.role) ? row.members : 0),
    })
  }
  return counts
}

/** Invitations of any role that still read pending at `now`, counted per Organization. */
async function countLiveInvitations(
  db: Database,
  organizationIds: ReadonlyArray<string>,
  now: Date,
): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({
      organizationId: invitation.organizationId,
      invitations: sql<number>`count(*)::int`,
    })
    .from(invitation)
    .where(
      and(
        inArray(invitation.organizationId, [...organizationIds]),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
      ),
    )
    .groupBy(invitation.organizationId)
  return new Map(rows.map((row) => [row.organizationId, row.invitations]))
}

/**
 * Open AccountAdmin invitations, newest first, of Organizations the caller
 * found to have no AccountAdmin. These are the only invitee addresses the
 * console reads: an administered Organization's invitees stay counts.
 */
async function readAdminInvitations(
  db: Database,
  ownerlessOrganizationIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<AdminInvitation>> {
  if (ownerlessOrganizationIds.length === 0) return []
  return db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(
      and(
        inArray(invitation.organizationId, [...ownerlessOrganizationIds]),
        inArray(invitation.status, [...OPEN_INVITATION_STATUSES]),
        invitationNamesOwner,
      ),
    )
    .orderBy(desc(invitation.createdAt), desc(invitation.id))
}

function toRow(
  head: OrganizationHead,
  facts: Readonly<{
    members: MemberCounts
    liveInvitations: number
    adminInvitations: ReadonlyArray<AdminInvitation>
  }>,
): PlatformOrganizationRow {
  return {
    id: toOrganizationId(head.id),
    name: head.name,
    slug: head.slug,
    createdAt: head.createdAt,
    lifecycleState: lifecycleState(head.state),
    memberCount: facts.members.memberCount,
    accountAdminCount: facts.members.accountAdminCount,
    pendingInvitationCount: facts.liveInvitations,
    adminInvitations: facts.adminInvitations.map((row): PlatformAdminInvitationRow => ({
      id: toInvitationId(row.id),
      email: row.email,
      status: row.status,
      expiresAt: row.expiresAt,
    })),
  }
}

async function takeSlug(tx: Tx, slug: string): Promise<void> {
  // Serialize provisioning per slug so a concurrent attempt waits, then sees
  // the committed row; the unique index stays the backstop.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-slug:${slug}`}, 0))`,
  )
  const taken = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)
  if (taken[0]) throw identityError('already_exists', SLUG_TAKEN_MESSAGE)
}

export function createPlatformOrganizationStore(
  db: Database,
  idGen: () => string,
): PlatformOrganizationStore {
  /**
   * Run one ordinary invitation command and its audit row in ONE transaction.
   * The command's own transaction becomes a savepoint of this one, so a
   * refusal there writes no audit row, and a failed audit row undoes the
   * change.
   */
  const audited = <T>(
    run: (commands: IdentityCommandStore) => Promise<T>,
    audit: OperatorAudit,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      const result = await run(
        createAtomicIdentityCommandStore(tx as unknown as Database, idGen),
      )
      await writeOperatorAudit(tx, audit)
      return result
    })

  return {
    listOrganizations: ({ limit, now }) =>
      trace('identity.platformStore.listOrganizations', async () => {
        const heads: ReadonlyArray<OrganizationHead> = await db
          .select(headColumns)
          .from(organization)
          .innerJoin(
            organizationLifecycleAuthority,
            eq(organizationLifecycleAuthority.organizationId, organization.id),
          )
          .orderBy(desc(organization.createdAt), desc(organization.id))
          .limit(limit)
        if (heads.length === 0) return []
        const ids = heads.map((head) => head.id)
        const [members, liveInvitations] = await Promise.all([
          countMembers(db, ids),
          countLiveInvitations(db, ids, now),
        ])
        const ownerless = ids.filter(
          (id) => (members.get(id) ?? NO_MEMBERS).accountAdminCount === 0,
        )
        const adminInvitations = await readAdminInvitations(db, ownerless)
        return heads.map((head) =>
          toRow(head, {
            members: members.get(head.id) ?? NO_MEMBERS,
            liveInvitations: liveInvitations.get(head.id) ?? 0,
            adminInvitations: adminInvitations.filter(
              (row) => row.organizationId === head.id,
            ),
          }),
        )
      }),

    readAdministration: (organizationId: OrganizationId) =>
      trace('identity.platformStore.readAdministration', async () => {
        const [head] = await db
          .select(headColumns)
          .from(organization)
          .innerJoin(
            organizationLifecycleAuthority,
            eq(organizationLifecycleAuthority.organizationId, organization.id),
          )
          .where(eq(organization.id, organizationId as string))
          .limit(1)
        if (!head) return null
        const members = (await countMembers(db, [head.id])).get(head.id) ?? NO_MEMBERS
        const adminInvitations =
          members.accountAdminCount === 0 ? await readAdminInvitations(db, [head.id]) : []
        const administration: OrganizationAdministration = {
          organizationId: toOrganizationId(head.id),
          name: head.name,
          lifecycleState: lifecycleState(head.state),
          accountAdminCount: members.accountAdminCount,
          openAdminInvitationIds: adminInvitations.map((row) => toInvitationId(row.id)),
        }
        return administration
      }),

    provisionOrganization: (command: ProvisionOrganizationCommand) =>
      trace('identity.platformStore.provisionOrganization', async () => {
        if (command.firstAdmin.organizationId !== command.organizationId) {
          throw new Error('The first AccountAdmin invitation names another Organization')
        }
        try {
          await db.transaction(async (tx) => {
            await takeSlug(tx, command.slug)
            await tx.insert(organization).values({
              id: command.organizationId as string,
              name: command.name,
              slug: command.slug,
              createdAt: command.now,
            })
            // The ordinary invitation command, bound to this transaction: its
            // own transaction becomes a savepoint, so a refusal there rolls
            // the Organization back with it.
            await createAtomicIdentityCommandStore(
              tx as unknown as Database,
              idGen,
            ).inviteMember(command.firstAdmin)
            await writeOperatorAudit(tx, {
              organizationId: command.organizationId,
              operatorUserId: command.firstAdmin.inviterId,
              action: 'platform.organization_provisioned',
              resourceType: 'organization',
              resourceId: command.organizationId as string,
              details: { invitationId: command.firstAdmin.invitationId as string },
              at: command.now,
            })
          })
        } catch (error) {
          if (violatesSlugUniqueness(error)) {
            throw identityError('already_exists', SLUG_TAKEN_MESSAGE)
          }
          throw error
        }
      }),

    inviteAdmin: (command: InviteMemberCommand) =>
      trace('identity.platformStore.inviteAdmin', () =>
        audited((commands) => commands.inviteMember(command), {
          organizationId: command.organizationId,
          // The operator is the invitation's inviter.
          operatorUserId: command.inviterId,
          action: 'platform.admin_invited',
          resourceType: 'invitation',
          resourceId: command.invitationId as string,
          at: command.now,
        }),
      ),

    renewAdminInvitation: (command: RenewInvitationCommand, operatorUserId: UserId) =>
      trace('identity.platformStore.renewAdminInvitation', () =>
        audited((commands) => commands.renewInvitation(command), {
          organizationId: command.organizationId,
          operatorUserId,
          action: 'platform.admin_invitation_resent',
          resourceType: 'invitation',
          resourceId: command.invitationId as string,
          at: command.now,
        }),
      ),

    cancelAdminInvitation: (command: CancelInvitationCommand, operatorUserId: UserId) =>
      trace('identity.platformStore.cancelAdminInvitation', () =>
        audited((commands) => commands.cancelInvitation(command), {
          organizationId: command.organizationId,
          operatorUserId,
          action: 'platform.admin_invitation_canceled',
          resourceType: 'invitation',
          resourceId: command.invitationId as string,
          at: command.event.occurredAt,
        }),
      ),
  }
}
