// Reset + deploy, end to end. The real deploy runner (scripts/migrate-deploy.ts,
// web's preDeployCommand) runs against a database this file creates EMPTY — a
// reset — so the AI heads really start at their seed generation, and the
// posture runs on a bare pg Client exactly as it does on Railway. The file
// drops its database afterwards; nothing touches the shared test database.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { testEnvironment } from '#/shared/testing/test-environment'
import { validateTestDatabaseTarget } from '#/shared/testing/test-environment-lease'
import {
  applyDeclaredCapabilityPosture,
  createDeclaredCapabilityPostureStores,
} from './declared-capability-posture'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SHA = 'e'.repeat(40)
// The one-run sealed migrator key CI's predeploy parity step uses: an empty
// database has no provider-subject inventory until the first deploy seeds it.
const MIGRATOR_KEY = `v1:${'cd'.repeat(32)}`
const OPERATOR = 'owner:ops@example.com'
const DEPLOY_TIMEOUT_MS = 180_000
const LOCK_WAIT_TIMEOUT_MS = 15_000

let scratchUrl: string
let db: Client

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function onMaintenance(url: string, statements: readonly string[]) {
  const client = new Client({ connectionString: withDatabase(url, 'postgres') })
  await client.connect()
  try {
    for (const statement of statements) await client.query(statement)
  } finally {
    await client.end()
  }
}

beforeAll(async () => {
  const base = testEnvironment().DATABASE_URL
  const baseName = decodeURIComponent(new URL(base).pathname.slice(1))
  const name = `${baseName}_posture_${randomUUID().slice(0, 8)}`
  scratchUrl = withDatabase(base, name)
  validateTestDatabaseTarget(scratchUrl)
  await onMaintenance(base, [`CREATE DATABASE "${name}"`])
  db = new Client({ connectionString: scratchUrl })
  await db.connect()
})

afterAll(async () => {
  await db?.end()
  if (!scratchUrl) return
  const name = decodeURIComponent(new URL(scratchUrl).pathname.slice(1))
  await onMaintenance(scratchUrl, [
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    `DROP DATABASE IF EXISTS "${name}"`,
  ])
})

type DeployRun = Readonly<{ code: number | null; stdout: string; stderr: string }>

/** Runs the deploy step the way CI's predeploy parity step does. */
function deploy(declared: Readonly<Record<string, string>>): Promise<DeployRun> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...testEnvironment(),
    NODE_ENV: 'test',
    DEPLOY_MIGRATE: '1',
    DATABASE_URL: scratchUrl,
    DATABASE_URL_POOLER: scratchUrl,
    GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '',
    AI_CAPABILITIES_ENABLED: '',
    RELEASE_SHA: '',
    IMAGE_SOURCE_REVISION: '',
    ...declared,
  }
  delete env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['-s', 'db:migrate-deploy'], { cwd: REPO_ROOT, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function postureLine(run: DeployRun): string | undefined {
  return run.stdout.split('\n').find((line) => line.startsWith('[declared-posture]'))
}

async function googleControls() {
  const result = await db.query<{
    capability: string
    denied: boolean
    operator_id: string | null
    reason: string | null
    emergency_kill_version: string
  }>(`
    SELECT capability::text, denied, operator_id, reason, emergency_kill_version::text
    FROM capability_execution_control ORDER BY capability
  `)
  return result.rows
}

async function aiCapabilityHeads() {
  const result = await db.query<{
    scope_key: string
    control_id: string
    generation: number
    execution_state: string
    admission_state: string
  }>(`
    SELECT scope_key, control_id, generation, execution_state, admission_state
    FROM ai_execution_control_heads
    WHERE scope_kind = 'capability' ORDER BY scope_key
  `)
  return result.rows
}

/** Puts the Google rows back to what drizzle/0002_db_seed.sql inserts. */
async function restoreGoogleSeed(): Promise<void> {
  await db.query(`
    UPDATE capability_execution_control
    SET denied = true, denied_at = now(), drained_at = NULL, cleanup_drained_at = NULL,
        operator_id = CASE WHEN capability IN ('property.connect_gbp', 'property.publish_reply')
                           THEN 'migration:0124' END,
        reason = CASE capability
          WHEN 'property.connect_gbp' THEN 'organization_ownership_expand_default_deny'
          WHEN 'property.publish_reply' THEN 'reply_publication_provider_authority_default_deny'
          ELSE 'migration_default_deny' END
  `)
}

async function waitUntilBlockedOnLock(pid: number): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
  for (;;) {
    const result = await db.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    )
    if (result.rows[0]?.waiting) return
    if (Date.now() > deadline) throw new Error('the posture never waited on the row lock')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('reset + deploy with a declared capability posture', () => {
  it(
    'refuses a mistyped capability before migrating anything',
    async () => {
      const run = await deploy({
        GOOGLE_CONTENT_CAPABILITIES_ALLOWED: 'property.conect_gbp',
      })

      expect(run.code).toBe(1)
      expect(run.stderr).toContain(
        '[declared-posture] refused before migrating: GOOGLE_CONTENT_CAPABILITIES_ALLOWED names unknown capability "property.conect_gbp"',
      )
      const tables = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM information_schema.tables
         WHERE table_schema IN ('public', 'drizzle')`,
      )
      expect(tables.rows[0]?.count).toBe(0)
    },
    DEPLOY_TIMEOUT_MS,
  )

  it(
    'leaves a reset database dark when nothing is declared',
    async () => {
      const run = await deploy({
        REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: MIGRATOR_KEY,
      })

      expect(run.code).toBe(0)
      expect(postureLine(run)).toBe(
        '[declared-posture] nothing declared (GOOGLE_CONTENT_CAPABILITIES_ALLOWED and AI_CAPABILITIES_ENABLED unset); controls left as they are',
      )
      expect((await googleControls()).every((row) => row.denied)).toBe(true)
      expect(await aiCapabilityHeads()).toEqual(
        ['property_trends', 'reply_drafting', 'review_analysis'].map((capability) =>
          expect.objectContaining({
            scope_key: `capability:${capability}`,
            generation: 1,
            execution_state: 'killed',
            admission_state: 'draining',
          }),
        ),
      )
    },
    DEPLOY_TIMEOUT_MS,
  )

  it('waits for an in-flight operator denial to commit, then keeps it', async () => {
    const operator = new Client({ connectionString: scratchUrl })
    const deployer = new Client({ connectionString: scratchUrl })
    await operator.connect()
    await deployer.connect()
    try {
      await operator.query('BEGIN')
      await operator.query(
        `UPDATE capability_execution_control
         SET operator_id = $1, reason = 'incident', denied_at = now()
         WHERE capability = 'property.connect_gbp'`,
        [OPERATOR],
      )
      const pid = (
        await deployer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]!.pid
      const pending = applyDeclaredCapabilityPosture({
        stores: createDeclaredCapabilityPostureStores(
          drizzle(deployer) as unknown as Database,
        ),
        posture: {
          google: ['property.import_gbp_v2', 'property.connect_gbp'],
          ai: [],
          candidateReleaseSha: null,
        },
        now: new Date(),
      })

      await waitUntilBlockedOnLock(pid)
      await operator.query('COMMIT')
      const report = await pending

      expect(report.google).toEqual([
        { capability: 'property.import_gbp_v2', outcome: 'lifted' },
        { capability: 'property.connect_gbp', outcome: 'kept_operator_denied' },
      ])
      expect(
        (await googleControls()).find((row) => row.capability === 'property.connect_gbp'),
      ).toMatchObject({ denied: true, operator_id: OPERATOR, reason: 'incident' })
    } finally {
      await operator.end()
      await deployer.end()
      await restoreGoogleSeed()
    }
  })

  it(
    'brings every declared Google and AI capability back on the next deploy',
    async () => {
      const run = await deploy({
        GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '*',
        AI_CAPABILITIES_ENABLED: '*',
        RELEASE_SHA: SHA,
      })

      expect(run.code).toBe(0)
      expect(postureLine(run)).toBe(
        '[declared-posture] google lifted=[property.import_gbp_v2,property.read_gbp_performance,property.connect_gbp,property.publish_reply] ' +
          'already_allowed=[] kept_operator_denied=[]; ai enabled=[review_analysis,reply_drafting,property_trends] ' +
          'already_enabled=[] kept_operator_killed=[] skipped_plane_stopped=[] skipped_head_absent=[]',
      )
      expect(
        (await googleControls()).map((row) => [row.denied, row.operator_id, row.reason]),
      ).toEqual(Array(4).fill([false, 'deploy:declared-posture', 'declared_posture']))
      expect(
        (await aiCapabilityHeads()).map((head) => [
          head.generation,
          head.execution_state,
          head.admission_state,
        ]),
      ).toEqual(Array(3).fill([2, 'enabled', 'accepting']))
      const audit = await db.query(`
        SELECT DISTINCT reason_code, actor_user_id, ticket_reference, candidate_release_sha
        FROM ai_execution_control_transitions
        WHERE scope_kind = 'capability' AND generation = 2
      `)
      expect(audit.rows).toEqual([
        {
          reason_code: 'operator_restore',
          actor_user_id: 'deploy:declared-posture',
          ticket_reference: 'declared-posture',
          candidate_release_sha: SHA,
        },
      ])
    },
    DEPLOY_TIMEOUT_MS,
  )

  it(
    'keeps what operators stopped since, and writes nothing on a later deploy',
    async () => {
      const replyDrafting = (await aiCapabilityHeads()).find(
        (head) => head.scope_key === 'capability:reply_drafting',
      )!
      await db.query(
        `SELECT generation FROM transition_ai_execution_control_v1(
           'capability:reply_drafting', 'private-beta-global-v1', $1::uuid, $2,
           'killed', 'draining', 'operator_kill', $3, 'INC-1', NULL)`,
        [replyDrafting.control_id, replyDrafting.generation, OPERATOR],
      )
      await db.query(
        `UPDATE capability_execution_control
         SET denied = true, denied_at = now(), operator_id = $1, reason = 'incident'
         WHERE capability = 'property.publish_reply'`,
        [OPERATOR],
      )
      const googleBefore = await googleControls()
      const aiBefore = await aiCapabilityHeads()

      const run = await deploy({
        GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '*',
        AI_CAPABILITIES_ENABLED: '*',
        RELEASE_SHA: SHA,
      })

      expect(run.code).toBe(0)
      expect(postureLine(run)).toBe(
        '[declared-posture] google lifted=[] already_allowed=[property.import_gbp_v2,property.read_gbp_performance,property.connect_gbp] ' +
          'kept_operator_denied=[property.publish_reply]; ai enabled=[] already_enabled=[review_analysis,property_trends] ' +
          'kept_operator_killed=[reply_drafting] skipped_plane_stopped=[] skipped_head_absent=[]',
      )
      expect(await googleControls()).toEqual(googleBefore)
      expect(await aiCapabilityHeads()).toEqual(aiBefore)
    },
    DEPLOY_TIMEOUT_MS,
  )
})
