// Test-only: the wiring, ids and seeds the Portal Group lifecycle integration
// suites share. The real use cases run over the real stores and command store;
// only the clock and ids are fixed.

import { freshUuid } from '#/shared/testing/fresh-uuid'
import type { Pool } from 'pg'
import { expect } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { createPropertyRepository } from '#/contexts/property/profile/property-repository.server'
import type { PropertyPublicApi } from '#/contexts/property/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { getDb } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../domain/errors'
import { movePortalToGroup } from '../groups/move-portal-to-group.server'
import { createPortalGroup } from '../groups/create-portal-group.server'
import { listPortalGroupHistory } from '../groups/list-portal-group-history.server'
import { removePortalFromGroup } from '../groups/remove-portal-from-group.server'
import { softDeletePortal } from './soft-delete-portal.server'
import { softDeletePortalGroup } from '../groups/soft-delete-portal-group.server'
import { updatePortalGroup } from '../groups/update-portal-group.server'
import { issuePortalToken } from '../addresses/issue-portal-token.server'
import { portalToRow } from './portal-mapper.server'
import { createPortalRepository } from './portal-repository.server'
import { createPortalGroupRepository } from '../groups/portal-group-repository.server'
import { createPortalGroupHistoryRepository } from '../groups/portal-group-history-repository.server'
import { createPortalTokenRepository } from '../addresses/portal-token-repository.server'
import { testPortalTokenCodec } from '../addresses/portal-token-codec.test-fixtures'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

export const ORG_A = organizationId('org-group-lifecycle-0000000000001')
export const ORG_B = organizationId('org-group-lifecycle-0000000000002')
export const MANAGER = userId('manager-group-lifecycle-000000001')
export const NOW = new Date('2026-09-30T10:00:00.000Z')
export const EARLIER = new Date('2026-09-01T10:00:00.000Z')
export const NEXT = new Date(NOW.getTime() + 1)

export const GROUP_LIFECYCLE_TABLES = [
  'portal_address_downloads',
  'portal_access_artifacts',
  'portal_tokens',
  'portal_group_history',
  'portal_group_memberships',
  'portal_groups',
  'outbox_events',
  'portal_responsible_managers',
  'portals',
  'properties',
] as const

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

export function wire(accessible: ReadonlyArray<PropertyId> | null = null) {
  const db = getDb()
  const propertyRepo = createPropertyRepository(db)
  const propertyApi = {
    propertyExists: async (org: OrganizationId, id: PropertyId) =>
      (await propertyRepo.findById(org, id)) !== null,
  } as unknown as PropertyPublicApi
  const common = {
    portalGroupRepo: createPortalGroupRepository(db),
    staffPublicApi: staffApi(accessible),
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    clock: () => NOW,
  }
  const portalRepo = createPortalRepository(db)
  return {
    create: createPortalGroup({
      ...common,
      portalRepo,
      propertyApi,
      idGen: () => portalGroupId(freshUuid()),
    }),
    update: updatePortalGroup(common),
    archive: softDeletePortalGroup(common),
    add: movePortalToGroup({ ...common, portalRepo }),
    remove: removePortalFromGroup(common),
    list: listPortalGroupHistory({
      portalGroupRepo: common.portalGroupRepo,
      portalGroupHistoryRepo: createPortalGroupHistoryRepository(db),
      staffPublicApi: common.staffPublicApi,
    }),
    deletePortal: softDeletePortal({ ...common, portalRepo }),
    issue: issuePortalToken({
      portalRepo,
      portalTokenRepo: createPortalTokenRepository(db),
      staffPublicApi: common.staffPublicApi,
      commandStore: common.commandStore,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      reportPrintCodeProblem: () => undefined,
      idGen: freshUuid,
      clock: () => NOW,
      address: {
        appOrigin: 'https://app.example.test',
        printOrigin: 'https://ap.example.test',
      },
    }),
  }
}

export const ctxOf = (
  org: OrganizationId,
  role: AuthContext['role'] = 'PropertyManager',
): AuthContext => buildTestAuthContext({ organizationId: org, userId: MANAGER, role })

const codeOf = (error: unknown): string | undefined =>
  isPortalError(error) ? error.code : undefined

/** The call is refused with this Portal error code. */
export const expectCode = (run: Promise<unknown>, code: string) =>
  expect(run).rejects.toSatisfy((error: unknown) => codeOf(error) === code)

export function createGroupLifecycleHarness(getPool: () => Pool) {
  async function seedProperty(org: OrganizationId): Promise<PropertyId> {
    const id = propertyId(freshUuid())
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Lifecycle property', $3, 'UTC', $4, $4)`,
      [id, org, `life-${id.slice(0, 8)}`, EARLIER],
    )
    return id
  }

  async function seedPortal(
    org: OrganizationId,
    property: PropertyId,
    overrides: Parameters<typeof buildTestPortal>[0] = {},
  ): Promise<PortalId> {
    const id = portalId(freshUuid())
    await getDb()
      .insert(portals)
      .values(
        portalToRow(
          buildTestPortal({
            id,
            organizationId: org,
            propertyId: property,
            entityId: property,
            name: `Portal ${id.slice(0, 8)}`,
            slug: `life-${id.slice(0, 8)}`,
            createdBy: MANAGER,
            createdAt: EARLIER,
            updatedAt: EARLIER,
            ...overrides,
          }),
        ),
      )
    return id
  }

  async function seedGroup(
    org: OrganizationId,
    property: PropertyId,
    name: string,
    updatedAt: Date = EARLIER,
  ): Promise<PortalGroupId> {
    const id = portalGroupId(freshUuid())
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, org, property, name, updatedAt],
    )
    return id
  }

  async function seedMembership(
    org: OrganizationId,
    property: PropertyId,
    portal: PortalId,
    group: PortalGroupId,
  ) {
    await getPool().query(
      `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
      [org, property, portal, group, EARLIER, MANAGER],
    )
  }

  const groupRows = async (org: OrganizationId) =>
    (
      await getPool().query(
        `SELECT id, name, created_by, updated_at, deleted_at FROM portal_groups
       WHERE organization_id = $1 ORDER BY name`,
        [org],
      )
    ).rows

  const membershipRows = async (org: OrganizationId, portal: PortalId) =>
    (
      await getPool().query(
        `SELECT portal_group_id AS "group", effective_to, end_reason
       FROM portal_group_memberships WHERE organization_id = $1 AND portal_id = $2
       ORDER BY effective_from, portal_group_id`,
        [org, portal],
      )
    ).rows

  const factsOf = async (org: OrganizationId, tag?: string) =>
    (
      await getPool().query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND ($2::text IS NULL OR event_type = $2)
       ORDER BY event_type`,
        [org, tag ?? null],
      )
    ).rows

  const historyRows = async (org: OrganizationId) =>
    (
      await getPool().query(
        `SELECT portal_group_id AS "group", kind, portal_id AS portal, name,
              previous_name AS previous, actor_user_id AS actor
       FROM portal_group_history WHERE organization_id = $1
       ORDER BY occurred_at, kind, portal_id NULLS FIRST, portal_group_id`,
        [org],
      )
    ).rows

  return {
    seedProperty,
    seedPortal,
    seedGroup,
    seedMembership,
    groupRows,
    membershipRows,
    factsOf,
    historyRows,
  }
}
