// In-memory PortalGroupRepository fake — for use case tests.
// Memberships are effective-dated like the real table, so a test can see that a
// move ended one membership with `moved_to_group` and began another.

import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { PortalGroup } from '#/contexts/portal/domain/types'
import type { OrganizationId, PortalGroupId, PortalId } from '#/shared/domain/ids'
import { portalGroupId, portalId } from '#/shared/domain/ids'

export type InMemoryMembership = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  portalGroupId: PortalGroupId
  effectiveFrom: Date
  effectiveTo: Date | null
  endReason: string | null
  createdBy: string
}>

export type InMemoryPortalGroupRepo = PortalGroupRepository &
  Readonly<{
    seed: (groups: ReadonlyArray<PortalGroup>) => void
    seedMembership: (portalId: PortalId, groupId: PortalGroupId, at?: Date) => void
    all: () => ReadonlyArray<PortalGroup>
    memberships: () => ReadonlyArray<InMemoryMembership>
  }>

export const createInMemoryPortalGroupRepo = (): InMemoryPortalGroupRepo => {
  const groups = new Map<string, PortalGroup>()
  let memberships: ReadonlyArray<InMemoryMembership> = []

  const live = (orgId: OrganizationId, group: PortalGroup | undefined) =>
    group !== undefined && group.organizationId === orgId && group.deletedAt === null
  const active = (orgId: OrganizationId) =>
    memberships.filter((m) => m.organizationId === orgId && m.effectiveTo === null)
  const replace = (target: InMemoryMembership, next: InMemoryMembership | null): void => {
    memberships = memberships.flatMap((m) => (m === target ? (next ? [next] : []) : [m]))
  }

  const repo: InMemoryPortalGroupRepo = {
    seed: (seeded) => seeded.forEach((group) => groups.set(String(group.id), group)),
    seedMembership: (pid, gid, at = new Date(0)) => {
      const group = groups.get(String(gid))
      if (!group) throw new Error('seed the group before its membership')
      memberships = [
        ...memberships,
        {
          organizationId: group.organizationId,
          portalId: pid,
          portalGroupId: gid,
          effectiveFrom: at,
          effectiveTo: null,
          endReason: null,
          createdBy: 'seed',
        },
      ]
    },
    all: () => [...groups.values()],
    memberships: () => memberships,

    findById: async (orgId, id) => {
      const group = groups.get(String(id))
      return live(orgId, group) ? (group ?? null) : null
    },
    listByProperty: async (orgId, propertyId) =>
      [...groups.values()].filter((g) => live(orgId, g) && g.propertyId === propertyId),
    listPortalGroupsWithPortals: async (orgId, propertyId) =>
      [...groups.values()]
        .filter((g) => live(orgId, g) && g.propertyId === propertyId)
        .map((g) => ({
          ...g,
          portalIds: active(orgId)
            .filter((m) => m.portalGroupId === g.id)
            .map((m) => m.portalId),
        })),
    nameExists: async (orgId, propertyId, name, excludeId) =>
      [...groups.values()].some(
        (g) =>
          live(orgId, g) &&
          g.propertyId === propertyId &&
          g.name === name &&
          g.id !== excludeId,
      ),
    insert: async (orgId, group) => {
      if (group.organizationId !== orgId) throw new Error('Tenant mismatch')
      groups.set(String(group.id), group)
    },
    update: async (orgId, id, patch) => {
      const group = groups.get(String(id))
      if (group && group.organizationId === orgId) {
        groups.set(String(id), { ...group, ...patch })
      }
    },
    softDelete: async (orgId, id, at) => {
      const group = groups.get(String(id))
      if (group && group.organizationId === orgId) {
        groups.set(String(id), { ...group, deletedAt: at })
      }
      for (const m of active(orgId).filter((x) => x.portalGroupId === id)) {
        replace(m, { ...m, effectiveTo: at, endReason: 'group_archived' })
      }
    },
    addPortal: async (orgId, groupId, pid, at, createdBy) => {
      memberships = [
        ...memberships,
        {
          organizationId: orgId,
          portalId: pid,
          portalGroupId: groupId,
          effectiveFrom: at,
          effectiveTo: null,
          endReason: null,
          createdBy,
        },
      ]
    },
    removePortal: async (orgId, groupId, pid, at, reason) => {
      const current = active(orgId).find(
        (m) => m.portalId === pid && m.portalGroupId === groupId,
      )
      if (!current) return false
      replace(current, { ...current, effectiveTo: at, endReason: reason })
      return true
    },
    findPortalMembership: async (orgId, pid) => {
      const current = active(orgId).find((m) => m.portalId === pid)
      return current ? portalGroupId(current.portalGroupId) : null
    },
    getGroupPortalIds: async (orgId, groupId) =>
      active(orgId)
        .filter((m) => m.portalGroupId === groupId)
        .map((m) => portalId(m.portalId)),
    findGroupIdsByPortalIds: async () => [],
    listGroupsForPortals: async () => [],
    findGroupForPortal: async (orgId, pid) => {
      const current = active(orgId).find((m) => m.portalId === pid)
      return current ? (groups.get(String(current.portalGroupId)) ?? null) : null
    },
  }
  return repo
}
