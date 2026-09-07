import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { deterministicFixtureHash } from '../../src/shared/testing/local-stack-controller'
import { deleteTestOrganizations } from '../../src/shared/testing/integration-helpers'

const VERSION = 'fleet-local-3'
const DEFAULT_PROPERTIES = 5_000

type InstrumentedQuery = Readonly<{
  ordinal: number
  name: 'scope' | 'summary' | 'page'
  rowCount: number
}>

function argument(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function positiveInteger(name: string, fallback: number): number {
  const raw = argument(name)
  if (raw == null) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function deterministicId(seed: string, ordinal: number): string {
  const hex = createHash('md5').update(`${seed}:${ordinal}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function instrumentedQuery<T extends Record<string, unknown>>(
  client: PoolClient,
  queries: InstrumentedQuery[],
  name: InstrumentedQuery['name'],
  text: string,
  values: readonly unknown[],
): Promise<QueryResult<T>> {
  const result = await client.query<T>(text, [...values])
  queries.push({ ordinal: queries.length + 1, name, rowCount: result.rowCount ?? 0 })
  return result
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const seed = argument('--seed') ?? 'beta-local-fleet-v1'
  const propertyCount = positiveInteger('--properties', DEFAULT_PROPERTIES)
  const artifactPath = resolve(
    process.cwd(),
    argument('--artifact') ??
      process.env.PERF_FLEET_ARTIFACT ??
      '/artifacts/perf/fleet-fixture.json',
  )
  const fixtureHash = deterministicFixtureHash({ seed, properties: propertyCount })
  const organizationId = `local-fleet-${fixtureHash.slice(0, 20)}`
  const organizationSlug = `local-fleet-${fixtureHash.slice(0, 12)}`
  const memberId = `local-fleet-member-${fixtureHash.slice(0, 20)}`
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM properties WHERE organization_id = $1', [
      organizationId,
    ])
    await deleteTestOrganizations(client, [organizationId])
    const user = await client.query<{ id: string }>(
      'SELECT id FROM "user" ORDER BY "createdAt", id LIMIT 1',
    )
    const userId = user.rows[0]?.id
    if (!userId) throw new Error('Fleet fixture requires the local seed user')

    await client.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt", metadata)
       VALUES ($1, 'Local Fleet Acceptance', $2, now(), $3)`,
      [
        organizationId,
        organizationSlug,
        JSON.stringify({ fixture: VERSION, fixtureHash }),
      ],
    )
    await client.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'AccountAdmin', now())`,
      [memberId, userId, organizationId],
    )

    const ids = Array.from({ length: propertyCount }, (_, index) =>
      deterministicId(seed, index + 1),
    )
    await client.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, country_code, country_source,
         lifecycle_state, source_epoch
       )
       SELECT id::uuid, $1, 'Fleet Property ' || lpad(ordinal::text, 5, '0'),
         'local-fleet-' || lpad(ordinal::text, 5, '0'), 'America/New_York', 'US',
         'manual', 'active', 0
       FROM unnest($2::text[]) WITH ORDINALITY AS fixture(id, ordinal)`,
      [organizationId, ids],
    )
    await client.query(
      `INSERT INTO property_access_grant (
         organization_id, property_id, user_id, source, created_by
       )
       SELECT $1, id, $2, 'operator', $2
       FROM properties WHERE organization_id = $1`,
      [organizationId, userId],
    )
    await client.query('COMMIT')

    const queries: InstrumentedQuery[] = []
    const scope = await instrumentedQuery<{ property_count: string }>(
      client,
      queries,
      'scope',
      `SELECT count(*)::text AS property_count
       FROM property_access_grant g
       JOIN properties p ON p.organization_id = g.organization_id AND p.id = g.property_id
       WHERE g.organization_id = $1 AND g.user_id = $2 AND g.revoked_at IS NULL
         AND (g.expires_at IS NULL OR g.expires_at > now())
         AND p.deleted_at IS NULL`,
      [organizationId, userId],
    )
    const summary = await instrumentedQuery<{ total: string }>(
      client,
      queries,
      'summary',
      `SELECT count(*)::text AS total
       FROM properties WHERE organization_id = $1 AND deleted_at IS NULL`,
      [organizationId],
    )
    const page = await instrumentedQuery<{ id: string; name: string }>(
      client,
      queries,
      'page',
      `SELECT id::text, name FROM properties
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY lower(name), id LIMIT 50`,
      [organizationId],
    )

    const observedProperties = Number(scope.rows[0]?.property_count ?? -1)
    const totalProperties = Number(summary.rows[0]?.total ?? -1)
    const assertions = {
      exactFixture:
        observedProperties === propertyCount && totalProperties === propertyCount,
      boundedStatements: queries.length <= 3,
      boundedPage: page.rows.length <= 50,
      stableCursorOrder: page.rows.every(
        (row, index, rows) =>
          index === 0 ||
          `${rows[index - 1]?.name.toLowerCase()}\u0000${rows[index - 1]?.id}` <
            `${row.name.toLowerCase()}\u0000${row.id}`,
      ),
    }
    if (Object.values(assertions).some((passed) => !passed)) {
      throw new Error(`Fleet fixture assertion failed: ${JSON.stringify(assertions)}`)
    }

    const evidence = {
      schemaVersion: VERSION,
      evidenceKind: 'synthetic-local-application-query',
      exclusions: ['hosted-capacity', 'managed-pitr', 'production-region'],
      fixtureHash,
      seed,
      organizationId,
      userId,
      properties: propertyCount,
      dashboardInstrumentation: {
        statementCount: queries.length,
        pageRows: page.rows.length,
        limit: 50,
        queries,
      },
      assertions,
    }
    mkdirSync(dirname(artifactPath), { recursive: true })
    writeFileSync(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(evidence))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
