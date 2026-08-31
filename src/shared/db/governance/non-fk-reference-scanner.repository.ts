import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  buildNonFkReferenceScanReport,
  resolveNonFkProbes,
  type NonFkProbe,
  type NonFkProbeResult,
  type NonFkReferenceScanReport,
} from '#/shared/governance/non-fk-reference-surfaces'

/**
 * Executes the declared non-FK probes against a real database.
 *
 * Every statement is a `count(*)`. The scanner never selects an identifier
 * value: knowing that 42 outbox rows still embed the id of a `teams` row is the
 * evidence a deletion slice needs, and knowing *which* ids they are is not. One
 * `REPEATABLE READ`, `READ ONLY` transaction covers the whole scan so the
 * counts describe a single instant, and the caller supplies the explicit
 * `--as-of` observation time that goes into the fingerprint.
 *
 * The json_document probes are deliberately a substring search over the
 * document text. It over-matches rather than under-matches: a false positive
 * costs an operator one manual check, a false negative costs a dangling
 * reference in production.
 */

const IDENTIFIER = /^_?[a-z][a-z0-9_]*$/
const DISCRIMINATOR = /^[a-z][a-z0-9_]*$/

function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error('non_fk_reference_identifier_invalid')
  return value
}

function probeQuery(probe: NonFkProbe): string {
  const surfaceTable = assertIdentifier(probe.surface.table)
  const referentTable = assertIdentifier(probe.referentTable)
  const identifierColumn = assertIdentifier(probe.surface.identifierColumn)
  const referentColumn = assertIdentifier(probe.referentIdentifierColumn)

  if (probe.surface.kind === 'json_document') {
    return `SELECT count(*)::text AS reference_count
FROM public."${surfaceTable}" AS surface
WHERE EXISTS (
  SELECT 1 FROM public."${referentTable}" AS referent
  WHERE strpos(surface."${identifierColumn}"::text, referent."${referentColumn}"::text) > 0
)`
  }

  const join =
    probe.surface.kind === 'uuid_column'
      ? `surface."${identifierColumn}" = referent."${referentColumn}"`
      : `surface."${identifierColumn}" = referent."${referentColumn}"::text`

  if (probe.surface.kind === 'resource_type_pair') {
    const discriminatorColumn = assertIdentifier(probe.surface.discriminatorColumn ?? '')
    const discriminator = probe.discriminator ?? ''
    if (!DISCRIMINATOR.test(discriminator)) {
      throw new Error('non_fk_reference_identifier_invalid')
    }
    return `SELECT count(*)::text AS reference_count
FROM public."${surfaceTable}" AS surface
JOIN public."${referentTable}" AS referent ON ${join}
WHERE surface."${discriminatorColumn}" = '${discriminator}'`
  }

  return `SELECT count(*)::text AS reference_count
FROM public."${surfaceTable}" AS surface
JOIN public."${referentTable}" AS referent ON ${join}`
}

function referenceCount(row: Readonly<Record<string, unknown>>): number {
  const countText = String(row.reference_count)
  if (!/^(0|[1-9][0-9]*)$/.test(countText)) {
    throw new Error('non_fk_reference_count_invalid')
  }
  const count = Number(countText)
  if (!Number.isSafeInteger(count)) throw new Error('non_fk_reference_count_invalid')
  return count
}

export const scanNonFkReferences = async (
  db: Database,
  input: Readonly<{
    evaluatedAt: Date
    /** Contraction candidate tables to scan, in report order. */
    referentTables: readonly string[]
    /** The full contraction candidate set the probes resolve against. */
    candidateTables: readonly string[]
  }>,
): Promise<NonFkReferenceScanReport> =>
  db.transaction(
    async (snapshot) => {
      const tables: Array<{
        tableName: string
        probes: NonFkProbeResult[]
      }> = []
      for (const referentTable of input.referentTables) {
        const probes: NonFkProbeResult[] = []
        for (const probe of resolveNonFkProbes(referentTable, input.candidateTables)) {
          const result = await snapshot.execute(sql.raw(probeQuery(probe)))
          probes.push({
            surfaceId: probe.surface.id,
            referenceCount: referenceCount(
              result.rows[0] as Readonly<Record<string, unknown>>,
            ),
          })
        }
        tables.push({ tableName: referentTable, probes })
      }
      return buildNonFkReferenceScanReport({ evaluatedAt: input.evaluatedAt, tables })
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
