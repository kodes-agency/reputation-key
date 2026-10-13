// Statements in the incident runbooks that an operator acts on, held to the
// code they describe. Each one used to name something that does not exist: a
// deploy order the deploy command cannot produce and a table the schema does
// not have.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/shared/db/schema'
import { CLOSED_BETA_IMAGE_SERVICES } from './deploy-ci-images'

const ROOT = resolve(import.meta.dirname, '../..')
const RUNBOOKS = readFileSync(resolve(ROOT, 'docs/operations/runbooks.md'), 'utf8')

/** Runbook section `number`, from its heading to the next one. */
const section = (number: number): string =>
  new RegExp(`^## ${number}\\. [^]*?(?=^## )`, 'm').exec(RUNBOOKS)?.[0] ??
  `runbook §${number} is missing`

describe('what the runbooks tell an operator to do', () => {
  // `pnpm ops deploy-ci-images` rolls the services in one fixed order and
  // takes no option for another. §24 asked for the worker before web.
  it('§24 gives the release order the deploy command rolls services in', () => {
    const [first, second] = CLOSED_BETA_IMAGE_SERVICES.map(
      ({ serviceName }) => serviceName,
    )

    expect(section(24)).toContain(`**Order: ${first} first, then the ${second}.**`)
  })

  // §5 sent the operator to `gbp_import_jobs`, a table the import rewrite
  // replaced, and told them to cancel a job no command can cancel.
  it('names only import tables the schema has', () => {
    const tables = new Set<string>(
      Object.values(schema).flatMap((value) =>
        isTable(value) ? [getTableName(value)] : [],
      ),
    )
    const cited = [...RUNBOOKS.matchAll(/`(gbp_import_[a-z_]+)`/g)].map(
      (match) => match[1] ?? '',
    )

    expect(cited.length).toBeGreaterThan(0)
    expect(cited.filter((name) => !tables.has(name))).toEqual([])
  })
})
