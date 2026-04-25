// Generic in-memory store for test fakes.
// Per conventions: "shared/ gets code when a second context needs it."
// Now used by property, team, and staff in-memory repos.

import type { OrganizationId } from '#/shared/domain/ids'

/** An entity that has id, organizationId, and deletedAt fields. */
type TenantEntity = {
  id: unknown
  organizationId: OrganizationId
  deletedAt: Date | null
}

/**
 * Create a generic in-memory store for test fakes.
 * Handles tenant isolation, soft-delete filtering, seed, and all.
 */
export function createInMemoryStore<T extends TenantEntity>() {
  const store = new Map<string, T>()

  return {
    store,

    /** Check if entity is accessible (correct org, not deleted). */
    isAccessible: (orgId: OrganizationId, entity: T): boolean =>
      entity.organizationId === orgId && entity.deletedAt === null,

    /** Get entity by string key. */
    get: (key: string): T | undefined => store.get(key),

    /** Set entity by string key. */
    set: (key: string, entity: T): void => {
      store.set(key, entity)
    },

    /** Get all entities. */
    values: (): ReadonlyArray<T> => [...store.values()],

    /** Filter entities by predicate. */
    filter: (predicate: (entity: T) => boolean): ReadonlyArray<T> =>
      [...store.values()].filter(predicate),

    /** Check if any entity matches predicate. */
    some: (predicate: (entity: T) => boolean): boolean =>
      [...store.values()].some(predicate),

    /** Seed test data. */
    seed: (
      entities: ReadonlyArray<T>,
      keyFn: (e: T) => string = (e) => e.id as string,
    ): void => {
      for (const e of entities) store.set(keyFn(e), e)
    },

    /** Get all entities (raw). */
    all: (): ReadonlyArray<T> => [...store.values()],
  }
}
