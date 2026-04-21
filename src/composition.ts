// Composition root — wires the full dependency graph.
// This is the only place where the full container is built.
// Both server and worker build it and use it.
//
// Per architecture: "No DI framework, no auto-wiring, no decorators.
// Dependencies are passed as function arguments. The wiring is in composition.ts, visible."
//
// Currently minimal — will be expanded as contexts are added.

import { getDb } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { getRedis } from '#/shared/cache/redis'

export function createContainer() {
  const db = getDb()
  const logger = getLogger()
  const redis = getRedis()

  // Repositories, adapters, and use cases will be wired here
  // as contexts are implemented in later phases.
  // Example:
  //   const propertyRepo = createPropertyRepository(db)
  //   const createProperty = createPropertyUseCase({ propertyRepo, eventBus })
  //   ...

  return {
    db,
    logger,
    redis,
  } as const
}

export type Container = ReturnType<typeof createContainer>
