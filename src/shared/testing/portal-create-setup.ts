// Test-only setup for the createPortal use case: in-memory repositories wired
// to the in-memory command store, with the Property, its groups, its default
// languages and its managers fixed so each test states only what it changes.
// Not imported by production code.

import { createInMemoryPortalRepo } from './in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from './in-memory-portal-link-repo'
import { createRecordedOutbox } from './recorded-outbox'
import { createInMemoryPortalCommandStore } from './in-memory-portal-command-store'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  portalId,
  propertyId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { PortalGroup } from '#/contexts/portal/domain/types'
import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { CopiedPortalOverride } from '#/contexts/portal/application/ports/portal-command-store.port'
import type { PortalLocalizedOverride } from '#/contexts/portal/application/ports/portal-experience.repository'
import type { PortalApprovedDestination } from '#/contexts/portal/domain/approved-destination'
import type { PortalGroupHistoryDraft } from '#/contexts/portal/domain/portal-group-history'
import { createPortal } from '#/contexts/portal/application/use-cases/create-portal'

export const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
export const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
export const CLOCK = new Date('2026-04-10T12:00:00Z')
export const CREATOR = 'user-00000000-0000-0000-0000-000000000001'

type Manager = Readonly<{
  userId: string
  role: 'AccountAdmin' | 'PropertyManager'
}>

export type CreatePortalSetupOptions = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  managers?: ReadonlyArray<Manager>
  propertyDefaults?: readonly GuestLocale[]
}>

/** A minimal group repository: what the creation path reads and what a membership writes. */
function createGroupRepo() {
  const groups = new Map<string, PortalGroup>()
  const memberships = new Map<string, PortalGroupId>()
  const repo: PortalGroupRepository & Readonly<{ seed: (group: PortalGroup) => void }> = {
    seed: (group) => void groups.set(String(group.id), group),
    findById: async (_org, id) => groups.get(String(id)) ?? null,
    update: async (_org, id, patch) => {
      const current = groups.get(String(id))
      if (current) groups.set(String(id), { ...current, ...patch })
    },
    addPortal: async (_org, groupId, pid) => void memberships.set(String(pid), groupId),
    findPortalMembership: async (_org, pid) => memberships.get(String(pid)) ?? null,
    listByProperty: async () => [],
    listPortalGroupsWithPortals: async () => [],
    nameExists: async () => false,
    insert: async () => {},
    softDelete: async () => {},
    removePortal: async () => false,
    getGroupPortalIds: async () => [],
    findGroupIdsByPortalIds: async () => [],
    listGroupsForPortals: async () => [],
    findGroupForPortal: async () => null,
  }
  return repo
}

export function setupCreatePortal(options: CreatePortalSetupOptions = {}) {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const portalGroupRepo = createGroupRepo()
  const outbox = createRecordedOutbox()
  const copiedOverrides = new Map<string, ReadonlyArray<CopiedPortalOverride>>()
  const destinations = new Map<string, PortalApprovedDestination>()
  const initialManagers = new Map<string, readonly string[]>()
  const sourceOverrides = new Map<string, readonly PortalLocalizedOverride[]>()
  const groupHistory: PortalGroupHistoryDraft[] = []
  const commandStore = createInMemoryPortalCommandStore({
    groupHistory,
    portalRepo,
    portalGroupRepo,
    portalLinkRepo,
    outbox,
    onCopiedOverrides: (id, overrides) => void copiedOverrides.set(id, overrides),
    onInitialManagers: (id, ids) => void initialManagers.set(id, ids),
  })
  const managers = options.managers ?? [{ userId: CREATOR, role: 'PropertyManager' }]
  const accessible = options.accessible === undefined ? [PROPERTY] : options.accessible
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
  }
  let portalCounter = 0
  let entityCounter = 0
  const newPortalId = (): PortalId =>
    portalId(`d0000000-0000-0000-0000-${String(++portalCounter).padStart(12, '0')}`)
  const deps = {
    portalRepo,
    portalGroupRepo,
    portalLinkRepo,
    destinationRepo: {
      list: async (_org, pid) =>
        [...destinations.values()].filter(
          (destination) => destination.propertyId === pid,
        ),
    },
    experienceRepo: {
      getPropertyExperience: async () => ({
        profile: options.propertyDefaults
          ? ({ defaultGuestLocales: options.propertyDefaults } as never)
          : null,
        content: [],
      }),
      listPortalOverrides: async (_org, _property, id) =>
        sourceOverrides.get(String(id)) ?? [],
    },
    propertyApi: {
      propertyExists: async (_org: OrganizationId, pid: PropertyId) =>
        pid === PROPERTY || pid === OTHER_PROPERTY,
      getPropertyName: async () => null,
      getPropertyTimezones: async () => [],
      getPropertyNames: async () => [],
      findByGbpLocationId: async () => null,
      getSourceEpoch: async () => ({ sourceEpoch: 0 }),
      findIdsByGoogleConnection: async () => [],
      findGoogleNotificationAnchor: async () => null,
      clearGoogleConnectionRef: async () => {},
    },
    staffPublicApi,
    identityPublicApi: {
      listActiveManagers: async () =>
        managers.map((manager) => ({
          ...manager,
          propertyAccessScope:
            manager.role === 'AccountAdmin'
              ? ('organization' as const)
              : ('assigned-properties' as const),
        })),
    },
    commandStore,
    idGen: newPortalId,
    entityIdGen: () =>
      `e0000000-0000-0000-0000-${String(++entityCounter).padStart(12, '0')}`,
    clock: () => CLOCK,
  } satisfies Parameters<typeof createPortal>[0]
  const useCase = createPortal(deps)
  return {
    useCase,
    optionsDeps: deps,
    portalRepo,
    portalLinkRepo,
    portalGroupRepo,
    outbox,
    commandStore,
    groupHistory,
    copiedOverrides,
    initialManagers,
    seedDestinations: (rows: readonly PortalApprovedDestination[]) => {
      for (const row of rows) destinations.set(String(row.id), row)
    },
    seedSourceOverrides: (id: PortalId, rows: readonly PortalLocalizedOverride[]) =>
      void sourceOverrides.set(String(id), rows),
  }
}
