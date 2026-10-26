// In-memory PortalLookRepository fake — for use in use case tests.
//
// It decides a save with the same rule the database repository does
// (`nextPortalLook`), from the Property look and the Portals it was seeded with,
// so a use case test sees the versions and changed facets a real save gives.

import type {
  PortalLookRepository,
  SavePortalLookPartInput,
} from '#/contexts/portal/application/ports/portal-look.repository'
import {
  lookSourcesOf,
  nextPortalLook,
  type PortalLookBase,
  type PortalLookOverride,
} from '#/contexts/portal/domain/portal-look'
import { portalId as toPortalId } from '#/shared/domain/ids'

type Scope = Readonly<{ organizationId: string; propertyId: string }>
type PortalScope = Scope & Readonly<{ portalId: string }>

export type InMemoryPortalLookRepo = PortalLookRepository &
  Readonly<{
    /** The Property look a Portal of this Property follows; a Property not seeded has no Brand Profile. */
    seedProperty: (input: Scope & Readonly<{ base: PortalLookBase }>) => void
    /** A Portal of the Property; an archived one still has its row but is not live. */
    seedPortal: (input: PortalScope & Readonly<{ archived?: boolean }>) => void
    /** A Portal's override as it is stored. */
    seed: (input: PortalScope & Readonly<{ override: PortalLookOverride }>) => void
    /** What each call to `savePortalLookPart` was given, oldest first. */
    saved: () => ReadonlyArray<SavePortalLookPartInput>
    /** Makes the next save fail, to prove what a caller does then. */
    failNextSave: (error: Error) => void
  }>

const propertyKey = (scope: Scope) => `${scope.organizationId}:${scope.propertyId}`
const portalKey = (scope: Readonly<{ organizationId: string; portalId: string }>) =>
  `${scope.organizationId}:${scope.portalId}`

export const createInMemoryPortalLookRepo = (): InMemoryPortalLookRepo => {
  const bases = new Map<string, PortalLookBase>()
  const portals = new Map<string, PortalScope & Readonly<{ archived: boolean }>>()
  const overrides = new Map<
    string,
    PortalScope & Readonly<{ override: PortalLookOverride }>
  >()
  const calls: SavePortalLookPartInput[] = []
  let pendingFailure: Error | null = null

  return {
    findForPortal: async (organizationId, propertyId, portalId) => {
      const stored = overrides.get(portalKey({ organizationId, portalId }))
      return stored?.propertyId === propertyId ? stored.override : null
    },
    listSourcesForPortals: async (organizationId, portalIds) =>
      portalIds.flatMap((portalId) => {
        const stored = overrides.get(portalKey({ organizationId, portalId }))
        return stored
          ? [{ portalId: toPortalId(portalId), sources: lookSourcesOf(stored.override) }]
          : []
      }),
    countLivePortals: async (organizationId, propertyId) =>
      [...portals.values()].filter(
        (portal) =>
          portal.organizationId === organizationId &&
          portal.propertyId === propertyId &&
          !portal.archived,
      ).length,
    savePortalLookPart: async (input) => {
      if (pendingFailure) {
        const failure = pendingFailure
        pendingFailure = null
        throw failure
      }
      calls.push(input)
      const portal = portals.get(portalKey(input))
      if (portal?.propertyId !== input.propertyId) return { status: 'portal_not_found' }
      const base = bases.get(propertyKey(input))
      if (!base) return { status: 'brand_profile_missing' }
      const current = overrides.get(portalKey(input))?.override ?? null
      const next = nextPortalLook(current, base, input.change)
      const sources = lookSourcesOf(next.override)
      // As the database repository: a Portal with no row told to follow everything needs none.
      const needsRow =
        current !== null || Object.values(sources).some((from) => from !== 'property')
      if (needsRow) {
        overrides.set(portalKey(input), {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          portalId: input.portalId,
          override: next.override,
        })
      }
      return { status: 'saved', ...next }
    },
    seedProperty: (input) => {
      bases.set(propertyKey(input), input.base)
    },
    seedPortal: (input) => {
      portals.set(portalKey(input), { ...input, archived: input.archived ?? false })
    },
    seed: (input) => {
      overrides.set(portalKey(input), input)
    },
    saved: () => calls,
    failNextSave: (error) => {
      pendingFailure = error
    },
  }
}
