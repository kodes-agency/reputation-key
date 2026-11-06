import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

export class UpgradeImageCheckError extends Error {}

function docker(args: string[]): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    // Commands carry fixture key bytes; never print their argument vector.
    throw new UpgradeImageCheckError(`Image check Docker ${args[0]} failed`)
  }
}

/** A contract refusal counts only when every other readiness dependency works. */
export function assertUpgradeReadiness(body: string, compatible: boolean): void {
  const result = JSON.parse(body) as {
    status: number
    body: Record<string, unknown>
  }
  const checks = result.body
  if (
    result.status !== (compatible ? 200 : 503) ||
    !checks ||
    checks.migrations !== compatible ||
    !['container', 'keys', 'db', 'redis', 'policy'].every((key) => checks[key] === true)
  ) {
    throw new Error('Image readiness did not match the upgraded database contract')
  }
}

/** Use only fixture keys, in their permitted process role. */
export function upgradeImageEnvironment(
  url: string,
  role: 'migrator' | 'web' | 'worker',
): Record<string, string> {
  const connection = new URL(url)
  connection.hostname = 'upgrade-postgres'
  connection.port = '5432'
  const defaults = parse(readFileSync('e2e/stack.env'))
  // Compose/shell quoted JSON escapes its quotes; dotenv preserves those
  // backslashes, so decode the two public keyrings before runtime validation.
  for (const name of [
    'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
    'AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON',
  ]) {
    defaults[name] = defaults[name]!.replaceAll('\\"', '"')
  }
  return {
    ...defaults,
    DATABASE_URL: connection.toString(),
    REDIS_URL: 'redis://upgrade-redis:6379',
    QUEUE_REDIS_URL: 'redis://upgrade-redis:6379',
    ...(role === 'worker'
      ? { REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${'cd'.repeat(32)}` }
      : {}),
    ...(role === 'migrator'
      ? { REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: `v1:${'cd'.repeat(32)}` }
      : {}),
    ...(role === 'worker'
      ? { AI_SUBJECT_HMAC_KEYS: defaults.WORKER_AI_SUBJECT_HMAC_KEYS! }
      : {}),
    ...(role === 'migrator' ? { DEPLOY_MIGRATE: '1' } : {}),
    LOG_FORMAT: 'json',
  }
}

function environment(url: string, role: 'migrator' | 'web' | 'worker'): string[] {
  return Object.entries(upgradeImageEnvironment(url, role)).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ])
}

export function migrateUpgradeImage(image: string, url: string): void {
  try {
    docker([
      'run',
      '--rm',
      '--network',
      'populated-upgrade',
      ...environment(url, 'migrator'),
      image,
      'node',
      'dist-worker/migrate-deploy.js',
    ])
  } catch {
    throw new UpgradeImageCheckError(`Image migration failed: ${image}`)
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1_000))

function assertUpgradeImageRunning(id: string, role: string, image: string): void {
  if (docker(['inspect', '--format', '{{.State.Running}}', id]).trim() === 'true') return
  const exitCode = docker(['inspect', '--format', '{{.State.ExitCode}}', id]).trim()
  throw new UpgradeImageCheckError(
    `Upgrade ${role} image exited before readiness (exit ${exitCode}): ${image}`,
  )
}

function readUpgradeWebReadiness(id: string) {
  const response = docker([
    'exec',
    id,
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>process.exit(1))",
  ])
  const parsed = JSON.parse(response) as {
    status: unknown
    body: Record<string, unknown>
  }
  const checks: Record<string, unknown> = Object.fromEntries(
    ['container', 'keys', 'db', 'redis', 'migrations', 'policy'].map((key) => [
      key,
      parsed.body?.[key] === true,
    ]),
  )
  checks.status = typeof parsed.status === 'number' ? parsed.status : null
  return { response, checks }
}

async function waitForUpgradeImageReadiness(
  id: string,
  role: 'web' | 'worker',
  image: string,
  compatible: boolean,
): Promise<void> {
  let lastReadiness: Record<string, unknown> = {}
  let workerInitialized = false
  for (let attempt = 0; attempt < 60; attempt++) {
    assertUpgradeImageRunning(id, role, image)
    if (role === 'worker') {
      const logs = docker(['logs', id])
      if (
        logs.includes('worker.startup_failed') ||
        logs.includes('Worker failed to start')
      )
        throw new UpgradeImageCheckError(`Upgrade worker image failed startup: ${image}`)
      // Released images emit this after scheduler reconciliation and the last
      // awaited startup work. Allow the remaining synchronous initialization
      // and its failure handler to run before checking liveness again.
      const initialized = logs.includes('Outbox relay started')
      if (workerInitialized && initialized) {
        assertUpgradeImageRunning(id, role, image)
        return
      }
      workerInitialized = initialized
    } else {
      try {
        const { response, checks } = readUpgradeWebReadiness(id)
        lastReadiness = checks
        assertUpgradeReadiness(response, compatible)
        return
      } catch {
        // Startup and dependency construction can still be in progress.
      }
    }
    await pause()
  }
  throw new UpgradeImageCheckError(
    `Upgrade ${role} image did not become ready: ${image}; checks=${JSON.stringify(lastReadiness)}`,
  )
}

export async function bootUpgradeImage(
  image: string,
  url: string,
  compatible = true,
): Promise<void> {
  const roleCommands = [
    { role: 'web' as const, command: [] },
    ...(compatible
      ? [
          {
            role: 'worker' as const,
            command: [
              'node',
              '--import',
              './dist-worker/worker-observability-preload.js',
              'dist-worker/index.js',
            ],
          },
        ]
      : []),
  ]
  for (const { role, command } of roleCommands) {
    const id = docker([
      'run',
      '--detach',
      '--network',
      'populated-upgrade',
      ...environment(url, role),
      image,
      ...command,
    ]).trim()
    try {
      await waitForUpgradeImageReadiness(id, role, image, compatible)
    } finally {
      docker(['rm', '--force', id])
    }
  }
}

export function upgradeImageJournal(image: string): { entries: { when: number }[] } {
  return JSON.parse(
    docker([
      'run',
      '--rm',
      '--network',
      'none',
      image,
      'node',
      '-e',
      "process.stdout.write(require('node:fs').readFileSync('drizzle/meta/_journal.json','utf8'))",
    ]),
  ) as {
    entries: { when: number }[]
  }
}
