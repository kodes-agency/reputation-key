// Simulate script — creates an isolated Neon branch, runs the simulation
// with invariant checks against inherited data, then cleans up.
//
// Usage: pnpm simulate
//
// The branch inherits ALL data from the parent (copy-on-write), so existing
// orgs/properties/reviews are available immediately — no migration needed.
// The simulation adds synthetic properties + reviews on top, then runs
// invariant checkers against the combined dataset.

import 'dotenv/config'
import { execSync } from 'child_process'
import { Pool } from 'pg'

const NEON_API = 'https://console.neon.tech/api/v2'

type NeonConfig = {
  apiKey: string
  projectId: string
  parentUrl: string
}

type BranchInfo = {
  branchId: string
  connectionUrl: string
}

function loadConfig(): NeonConfig {
  const apiKey = process.env.NEON_API_KEY
  const projectId = process.env.NEON_PROJECT_ID
  const parentUrl = process.env.DATABASE_URL
  if (!apiKey || !projectId || !parentUrl) {
    console.error('Missing NEON_API_KEY, NEON_PROJECT_ID, or DATABASE_URL in .env')
    process.exit(1)
  }
  return { apiKey, projectId, parentUrl }
}

async function neonFetch(
  config: NeonConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Neon API ${res.status}: ${body}`)
  }
  return res.json()
}

async function createBranch(config: NeonConfig): Promise<BranchInfo> {
  const branchName = `sim-${Date.now()}`
  console.log(`Creating Neon branch: ${branchName}...`)

  const data = (await neonFetch(config, `/projects/${config.projectId}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { name: branchName },
      endpoints: [{ type: 'read_write' }],
    }),
  })) as {
    branch: { id: string }
    endpoints: ReadonlyArray<{ host: string }>
  }

  const branchId = data.branch.id
  const endpoint = data.endpoints[0]
  if (!endpoint) throw new Error('No endpoint returned for branch')

  const original = new URL(config.parentUrl)
  original.hostname = endpoint.host
  const connectionUrl = original.toString()

  console.log(`  Branch ID: ${branchId}`)
  console.log(`  Endpoint:  ${endpoint.host}`)
  return { branchId, connectionUrl }
}

async function deleteBranch(config: NeonConfig, branchId: string): Promise<void> {
  console.log(`\nCleaning up branch ${branchId}...`)
  await neonFetch(config, `/projects/${config.projectId}/branches/${branchId}`, {
    method: 'DELETE',
  })
  console.log('  Branch deleted')
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function waitForBranch(connectionUrl: string, maxRetries = 15): Promise<void> {
  process.stdout.write('Waiting for branch endpoint...')
  for (let i = 0; i < maxRetries; i++) {
    const pool = new Pool({
      connectionString: connectionUrl,
      connectionTimeoutMillis: 5000,
    })
    try {
      const client = await pool.connect()
      client.release()
      console.log(' ready')
      return
    } catch {
      process.stdout.write('.')
      await sleep(3000)
    } finally {
      await pool.end().catch(() => undefined)
    }
  }
  throw new Error(`not ready after ${maxRetries} retries`)
}

async function resolveOrgId(connectionUrl: string): Promise<string> {
  const pool = new Pool({ connectionString: connectionUrl })
  try {
    const result = await pool.query('SELECT id FROM organization LIMIT 1')
    const orgId = result.rows[0]?.id as string | undefined
    if (!orgId) {
      console.error('No organization found. Register one in the dev DB first.')
      process.exit(1)
    }
    return orgId
  } finally {
    await pool.end()
  }
}

function runSimulation(connectionUrl: string, orgId: string): void {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Running simulation for org: ${orgId}`)
  console.log('─'.repeat(60))

  execSync(`npx tsx scripts/seed.ts --org=${orgId} --invariants`, {
    stdio: 'inherit',
    timeout: 240000,
    env: { ...process.env, DATABASE_URL: connectionUrl },
  })
}

async function main(): Promise<void> {
  const config = loadConfig()
  let branch: BranchInfo | undefined

  try {
    branch = await createBranch(config)
    await waitForBranch(branch.connectionUrl)

    const orgId = await resolveOrgId(branch.connectionUrl)
    runSimulation(branch.connectionUrl, orgId)
  } finally {
    if (branch) {
      await deleteBranch(config, branch.branchId).catch((e) => {
        console.error('Failed to delete branch:', e)
      })
    }
  }
}

main().catch((e) => {
  console.error('\n Simulation failed:', e)
  process.exit(1)
})
