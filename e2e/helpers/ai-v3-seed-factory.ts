// The v3 seed's graph (the AI stores, their JSON catalogues, the event schemas), opened for
// an e2e spec. Playwright's own loader cannot read that graph, because Node refuses a JSON
// import that carries no `type: 'json'` attribute; tsx's loader can. `ai-v3-fixtures.ts`
// therefore loads this module with tsx's `tsImport` and never imports it statically (a type
// import is erased, so the types stay checked).
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  createV3Seed,
  seededReviewId,
  type SeededIds,
} from '../../src/contexts/ai/infrastructure/testing/ai-v3-seed'

export { seededReviewId }

/** The seed on its own small connection pool, adopting the Organization and Property in `ids`. */
export function openV3Seed(databaseUrl: string, ids: SeededIds) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    // Let the Playwright worker exit when the suite is done, as the fixtures' own pool does.
    allowExitOnIdle: true,
  })
  return {
    seed: createV3Seed(drizzle(pool), ids, { adopt: true }),
    close: () => pool.end(),
  }
}

export type OpenV3Seed = ReturnType<typeof openV3Seed>
