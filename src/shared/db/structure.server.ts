import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { Pool } from 'pg'
import {
  collectMigrationJournalFaults,
  type MigrationJournalFault,
} from './migration-journal-order'

const STRUCTURE = new URL('./structure.sql', import.meta.url)
const START = '-- PostgreSQL database dump\n--\n'
const END = '\n--\n-- PostgreSQL database dump complete\n--'

/** Only the envelope is normalized; SQL, including quoted function bodies, stays verbatim. */
export function normalizeStructure(dump: string): string {
  const sql = dump
  const start = sql.indexOf(START)
  const end = sql.lastIndexOf(END)
  const settings = sql.indexOf('SET statement_timeout = 0;\n')
  if (start !== 3 || settings < start || end <= settings) {
    throw new Error('Expected a complete PostgreSQL schema dump')
  }
  const envelope = sql.slice(0, settings)
  const keys = [...envelope.matchAll(/^\\restrict ([A-Za-z0-9]+)$/gmu)]
  const suffix = sql.slice(end + END.length).trim()
  const expectedSuffix = keys[0] ? `\\unrestrict ${keys[0][1]}` : ''
  const validHeader = envelope
    .split('\n')
    .every(
      (line) =>
        line === '' ||
        line === '--' ||
        line === '-- PostgreSQL database dump' ||
        line.startsWith('-- Dumped from database version ') ||
        line.startsWith('-- Dumped by pg_dump version ') ||
        /^\\restrict [A-Za-z0-9]+$/u.test(line),
    )
  if (!validHeader || keys.length > 1 || suffix !== expectedSuffix) {
    throw new Error('Expected a complete PostgreSQL schema dump')
  }
  // Newer clients add transaction_timeout to the session preamble. It does
  // not describe a database object and is unsupported by older servers.
  const objects = sql.indexOf('\n--\n-- Name:', settings)
  if (objects === -1 || objects >= end) {
    throw new Error('Expected a complete PostgreSQL schema dump')
  }
  const preambleEnd = objects
  const preamble = sql
    .slice(settings, preambleEnd)
    .replace(/^SET transaction_timeout = 0;\n/mu, '')
  return `--\n${START}\n${preamble}${sql.slice(preambleEnd, end)}${END}\n`
}

export function compareStructures(
  expected: string,
  actual: string,
): readonly MigrationJournalFault[] {
  const want = normalizeStructure(expected).split('\n')
  const have = normalizeStructure(actual).split('\n')
  const position = want.findIndex((line, index) => line !== have[index])
  if (position === -1 && want.length === have.length) return []
  const line = position === -1 ? want.length : position
  // Do not print SQL: function bodies and defaults can contain sensitive literals.
  return [
    {
      object: 'structure.sql',
      detail: `schema differs at line ${line + 1}; regenerate the canonical dump from a freshly migrated disposable database and review the SQL diff`,
    },
  ]
}

/** A stable client major is required for reproducible SQL rendering. */
export function requireStructureClient(version: string): void {
  if (!/^pg_dump \(PostgreSQL\) 16\.\d+\b/u.test(version)) {
    throw new Error('Canonical structure requires PostgreSQL 16 pg_dump')
  }
}

function runDump(args: string[], databaseUrl: string): Promise<string> {
  const connection = new URL(databaseUrl)
  const password =
    connection.searchParams.get('password') ??
    (connection.password ? decodeURIComponent(connection.password) : undefined)
  connection.password = ''
  connection.searchParams.delete('password')
  connection.searchParams.set(
    'options',
    `${connection.searchParams.get('options') ?? ''} -c default_transaction_read_only=on`.trim(),
  )
  // URLSearchParams writes a space as '+', which libpq does not decode.
  connection.search = connection.searchParams.toString().replaceAll('+', '%20')
  return new Promise<string>((resolve, reject) => {
    execFile(
      'pg_dump',
      // libpq expands a URI only through an explicit dbname. Keep its password
      // in the child environment, outside process arguments and error output.
      [...args, '--dbname', connection.toString()],
      {
        env: {
          ...process.env,
          ...(password === undefined ? {} : { PGPASSWORD: password }),
          PGOPTIONS: '-c default_transaction_read_only=on',
        },
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 60_000,
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              'Schema dump failed; check PostgreSQL client availability, version compatibility and database access',
            ),
          )
        else resolve(stdout)
      },
    )
  })
}

/** pg_dump uses a separate, read-only connection and never includes table data. */
export async function readStructure(databaseUrl: string): Promise<string> {
  requireStructureClient(await runDump(['--version'], databaseUrl))
  return normalizeStructure(
    await runDump(
      [
        '--schema-only',
        '--no-owner',
        '--no-privileges',
        '--no-comments',
        '--no-security-labels',
        '--no-tablespaces',
        '--quote-all-identifiers',
        '--lock-wait-timeout=5s',
        '--exclude-table=public._test_lease',
      ],
      databaseUrl,
    ),
  )
}

async function journalFaults(
  databaseUrl: string,
): Promise<readonly MigrationJournalFault[]> {
  const pool = new Pool({
    connectionString: databaseUrl,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  })
  try {
    const result = await pool.query<{ hash: string; createdAt: string }>(
      'SELECT hash, created_at AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
    )
    return collectMigrationJournalFaults(
      result.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.createdAt) })),
    )
  } finally {
    await pool.end()
  }
}

export async function checkStructure(
  databaseUrl: string,
): Promise<readonly MigrationJournalFault[]> {
  // Module-relative constant; callers cannot select a file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const expected = await readFile(STRUCTURE, 'utf8')
  return [
    ...compareStructures(expected, await readStructure(databaseUrl)),
    ...(await journalFaults(databaseUrl)),
  ]
}

/** The caller must first validate that this is a disposable reference database. */
export async function writeStructure(databaseUrl: string): Promise<void> {
  const faults = await journalFaults(databaseUrl)
  if (faults.length > 0)
    throw new Error(
      'Cannot record structure.sql: migration journal is incomplete or differs from disk',
    )
  // Module-relative constant; callers cannot select a file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(STRUCTURE, await readStructure(databaseUrl), 'utf8')
}
