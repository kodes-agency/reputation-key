import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll } from 'vitest'
import type { Database } from '#/shared/db/index'
import { newTestId, testDatabaseUrl } from '#/shared/testing/ambient-test-runtime'
import type { Tx } from '#/shared/outbox/commit'
import { organizationId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  seedStaffAccountFixture,
  seedStaffAccountUser,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from '#/shared/testing/staff-account-fixture'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { identityMemberRemoved } from '../domain/events'
import type { StaffOnboardingStep } from '../domain/staff-account'
import { createAtomicIdentityCommandStore } from '../members/identity-command-store.server'
import type { StaffAccountDeps } from './add-staff-member.server'
import { createStaffAccountStore } from './staff-account-store.server'
import { replaceStaffInvitation } from './staff-invitation-correction.server'
import type { StaffManagementStore } from './staff-management-store.port.server'

export type StaffHarness = Awaited<
  ReturnType<ReturnType<typeof useStaffAccountEnv>['setup']>
>

/** Registers the lease and per-fixture cleanup hooks and returns the shared staff-account helpers. */
export function useStaffAccountEnv() {
  let lease: TestLease
  let db: Database
  let fixtures: StaffAccountFixture[] = []
  beforeAll(async () => {
    lease = await acquireTestLease(testDatabaseUrl())
    db = drizzle(lease.pool) as Database
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(async () => {
    for (const row of fixtures) await cleanStaffAccountFixture(lease.pool, row)
    fixtures = []
  })
  afterAll(async () => {
    clearEventSchemas()
    await lease.release()
  })

  const rows = async (text: string, params?: unknown[]) =>
    (await lease.pool.query(text, params)).rows as Record<string, unknown>[]

  async function insertMember(org: string, user: string, role: string) {
    const memberId = newTestId()
    await lease.pool.query(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [memberId, org, user, role, NOW],
    )
    return memberId
  }

  async function insertSession(user: string, activeOrganizationId: string | null = null) {
    await lease.pool.query(
      'INSERT INTO session (id, "userId", token, "expiresAt", "createdAt", "updatedAt", "activeOrganizationId") VALUES ($1,$2,$3,$4,$5,$5,$6)',
      [
        newTestId(),
        user,
        newTestId(),
        new Date(NOW.getTime() + 86400000),
        NOW,
        activeOrganizationId,
      ],
    )
  }

  async function seedExistingMember(
    h: StaffHarness,
    role: string,
    dropInvitation = true,
  ) {
    await seedStaffAccountUser(lease.pool, h.row)
    if (dropInvitation) {
      await lease.pool.query('DELETE FROM invitation WHERE id = $1', [h.row.invitationId])
    }
    return insertMember(h.row.organizationId, h.row.userId, role)
  }

  async function setup(fault?: StaffOnboardingStep) {
    const row = await seedStaffAccountFixture(lease.pool)
    fixtures = [...fixtures, row]
    await insertMember(row.organizationId, row.inviterId, 'owner')
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      organizationId: organizationId(row.organizationId),
      userId: userId(row.inviterId),
    })
    let pending = !!fault
    const fail = (step: StaffOnboardingStep) => {
      if (pending && step === fault) {
        pending = false
        throw Object.assign(new Error('Injected checkpoint failure'), {
          code: 'injected_failure',
        })
      }
    }
    const base = createStaffAccountStore(db, () => NOW, newTestId, 7 * 86_400_000)
    const decorate = (store: typeof base): typeof base => ({
      ...store,
      withAddressLock: (email, run) =>
        store.withAddressLock(email, (locked) => run(decorate(locked))),
      createPerson: async (operation) => {
        await store.createPerson(operation)
        fail('person')
      },
      assignPortal: async (operation, writePortalName) => {
        await store.assignPortal(operation, writePortalName)
        fail('responsibility')
      },
      grantAccess: async (operation, spend) => {
        const result = await store.grantAccess(operation, spend)
        fail('access')
        return result
      },
    })
    const deps: StaffAccountDeps = {
      store: decorate(base),
      spendAddressCheckBudget: async () => undefined,
      reportDeliveryFailure: () => undefined,
      idGen: newTestId,
      authorizeProperty: async () => undefined,
      invitationBudget: async () => 20,
      spendInvitationBudget: async () => undefined,
      deliverAccess: async () => undefined,
      portals: {
        archiveForMemberDeparture: async () => undefined,
        check: async () => ({ omittedLinks: [] }),
        rename: async (input, _ctx, transaction) => {
          await (transaction as Tx).execute(
            sql`UPDATE portals SET name = ${input.displayName} WHERE organization_id = ${row.organizationId} AND id IN (${
              input.portalIds.length
                ? sql.join(
                    input.portalIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )
                : sql`NULL::uuid`
            })`,
          )
        },
        create: async (input) => {
          await lease.pool.query(
            "INSERT INTO portals (id, organization_id, property_id, entity_id, name, public_name, slug, kind) VALUES ($1::uuid, $2, $3::uuid, $3::text, $4, 'Harbor', $5, 'personal') ON CONFLICT (id) DO NOTHING",
            [
              input.portalId,
              row.organizationId,
              row.propertyId,
              input.displayName,
              `portal-${input.portalId.slice(0, 8)}`,
            ],
          )
          fail('portal')
        },
        issueCode: async () => {
          fail('code')
        },
        publish: async () => {
          fail('publication')
        },
        archive: async () => undefined,
      },
    }
    const input = {
      operationId: newTestId(),
      propertyId: row.propertyId,
      email: `new-${newTestId()}@example.com`,
      displayName: 'New colleague',
    }
    return { row, ctx, base, deps, input }
  }

  /** Dependencies for removeStaffMember: Portal archive writes the state, login removal is staff-only. */
  function removalDeps(
    h: StaffHarness,
    management: StaffManagementStore,
    { afterLogin }: { afterLogin?: () => void } = {},
  ) {
    const commands = createAtomicIdentityCommandStore(db, newTestId)
    return {
      ...h.deps,
      management,
      portals: {
        ...h.deps.portals,
        archive: async (id: string) => {
          await lease.pool.query(
            "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
            [id],
          )
        },
      },
      removeLogin: async (memberId: string, targetUserId: string, ctx: typeof h.ctx) => {
        await commands.removeMember({
          organizationId: ctx.organizationId,
          memberId,
          staffOnly: true,
          event: identityMemberRemoved({
            organizationId: ctx.organizationId,
            userId: userId(targetUserId),
            removedBy: ctx.userId,
            occurredAt: NOW,
          }),
        })
        afterLogin?.()
      },
    }
  }

  function replace(
    h: StaffHarness,
    added: { participationId: string },
    email = 'corrected@example.com',
    spend: () => Promise<void> = async () => undefined,
  ) {
    return replaceStaffInvitation(
      db,
      () => NOW,
      7 * 86_400_000,
    )(
      {
        organizationId: h.row.organizationId,
        participationId: added.participationId,
        oldEmail: h.input.email,
        email,
        invitationId: newTestId(),
        actorId: h.row.inviterId,
      },
      spend,
    )
  }

  return {
    get db() {
      return db
    },
    get pool() {
      return lease.pool
    },
    setup,
    rows,
    insertMember,
    insertSession,
    seedExistingMember,
    removalDeps,
    replace,
  }
}
