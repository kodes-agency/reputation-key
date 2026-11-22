// Test-only: the small query kit the Portal creation and intent integration
// suites share (rows, counts, outbox facts, the error code a call ends with),
// bound to the suite's own pool and default Organization.

import type { Pool } from 'pg'
import { isPortalError } from '../domain/errors'

export function createCreationQueries(getPool: () => Pool, defaultOrganization: string) {
  const rows = async (sql: string, ...values: unknown[]) =>
    (await getPool().query(sql, values)).rows

  const countOf = async (table: string, org: string = defaultOrganization) =>
    Number(
      (
        await rows(
          `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
          org,
        )
      )[0].n,
    )

  const portalRows = (org: string = defaultOrganization) =>
    rows(
      `SELECT id, slug, name, publication_state FROM portals WHERE organization_id = $1 ORDER BY slug`,
      org,
    )

  const factsOf = (tag: string, org: string = defaultOrganization) =>
    rows(
      `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2`,
      org,
      tag,
    ).then((found) => found.map((row) => row.payload))

  return { rows, countOf, portalRows, factsOf }
}

/** The Portal error code a call ends with; undefined when it succeeds. */
export const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}
