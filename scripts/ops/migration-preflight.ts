import { z } from 'zod/v4'
import { contractionRequirement } from '../../src/shared/db/migration-safety'
import { checkedOutput, parseJson, type CommandRunner } from './command-runner'

export type ContractRequirement = Readonly<{ tag: string; readerRemoval: string }>

/** Check only unapplied entries in the selected image's migration history. */
export function readPendingContractRequirements(
  revision: string,
  runner: CommandRunner,
  databaseTargetArgs: readonly string[],
): ContractRequirement[] {
  const show = (path: string) =>
    checkedOutput(runner, 'git', ['show', `${revision}:${path}`])
  const journal = JSON.parse(show('drizzle/meta/_journal.json')) as {
    entries: { tag: string; when: number }[]
  }
  if (!Array.isArray(journal.entries))
    throw new Error('Cannot read deployment migration history')
  const contracts = journal.entries.flatMap(({ tag, when }) => {
    if (!/^[a-z_0-9]+$/i.test(tag)) throw new Error('Invalid migration tag')
    const readerRemoval = contractionRequirement(show(`drizzle/${tag}.sql`), {
      tag,
      when,
    })
    if (!readerRemoval) return []
    if (!Number.isSafeInteger(when)) throw new Error('Invalid migration timestamp')
    return [{ tag, readerRemoval, when }]
  })
  if (!contracts.length) return []
  // Query Postgres itself: a failed predeploy may have applied the contract
  // while neither application service can run or report healthy.
  const applied = new Set(
    parseJson(
      checkedOutput(runner, 'railway', [
        'ssh',
        ...databaseTargetArgs,
        '--',
        `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000' psql -XAtq -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" -c 'SELECT coalesce(json_agg(created_at), json_build_array()) FROM drizzle.__drizzle_migrations'`,
      ]),
      z.array(z.number().int().safe()),
      'Applied migration timestamps',
    ),
  )
  return contracts
    .filter(({ when }) => !applied.has(when))
    .map(({ tag, readerRemoval }) => ({ tag, readerRemoval }))
}

export type RunningReaderRevision = Readonly<{
  serviceName: string
  revision: string | null
  healthy: boolean
  runningDigest: string | null
  revisionDigest: string | null
}>

/** Variables and configured sources cannot prove which readers are running. */
export function assertContractionPreflight(
  requirements: readonly ContractRequirement[],
  running: readonly RunningReaderRevision[],
  isAncestor: (ancestor: string, descendant: string) => boolean,
): void {
  for (const requirement of requirements) {
    for (const serviceName of ['web', 'worker']) {
      const service = running.find((candidate) => candidate.serviceName === serviceName)
      if (
        !service?.healthy ||
        !service.revision ||
        !service.runningDigest ||
        service.runningDigest !== service.revisionDigest ||
        !isAncestor(requirement.readerRemoval, service.revision)
      ) {
        throw new Error(
          `Contract ${requirement.tag} refused: ${serviceName} must be running a healthy, verified reader-removal revision`,
        )
      }
    }
  }
}
