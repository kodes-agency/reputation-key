#!/usr/bin/env node
// `pnpm local:doctor` — read-only preflight for the plain local Compose stack.
// It checks Docker availability, published host ports, stale containers and
// Docker Desktop headroom. It never changes the machine.

import { createConnection } from 'node:net'
import { spawnSync } from 'node:child_process'

/** Host ports published by compose.local.yml (4900 belongs to the media profile). */
const REQUIRED_PORTS = [
  { port: 3000, who: 'web' },
  { port: 3001, who: 'web-locked' },
  { port: 4100, who: 'provider-sandbox' },
  { port: 4101, who: 'mail-stub' },
  { port: 4102, who: 'ai-provider-stub' },
  { port: 4900, who: 'object-store (media profile)' },
  { port: 55432, who: 'postgres' },
  { port: 56379, who: 'redis' },
]

const results = []
const record = (ok, name, detail) => results.push({ ok, name, detail })

// ── docker ─────────────────────────────────────────────────────────────
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8',
})
const dockerUp = docker.status === 0
record(
  dockerUp,
  'docker daemon reachable',
  dockerUp
    ? `server ${docker.stdout.trim()}`
    : 'start Docker Desktop — compose builds fail with an EOF rpc error while it is down',
)

// ── ports ──────────────────────────────────────────────────────────────
const probePort = ({ port, who }) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const settle = (busy) => {
      socket.destroy()
      resolve({ port, who, busy })
    }
    socket.setTimeout(700, () => settle(false))
    socket.on('connect', () => settle(true))
    socket.on('error', () => settle(false))
  })

const ports = await Promise.all(REQUIRED_PORTS.map(probePort))
const taken = ports.filter((p) => p.busy)
record(
  taken.length === 0,
  'stack host ports free',
  taken.length === 0
    ? REQUIRED_PORTS.map((p) => p.port).join(', ')
    : taken
        .map(({ port, who }) => `:${port} (${who}) is in use — free it or stop the stack`)
        .join('; '),
)

// ── stale stack ────────────────────────────────────────────────────────
if (dockerUp) {
  const stale = spawnSync('docker', ['ps', '-aq', '--filter', 'name=repkey-e2e'], {
    encoding: 'utf8',
  })
  const count = stale.stdout.trim() ? stale.stdout.trim().split('\n').length : 0
  record(
    count === 0,
    'no stale stack containers',
    count === 0 ? 'clean' : `${count} left over — run \`pnpm e2e:stack:down\``,
  )
}

// ── docker VM headroom ─────────────────────────────────────────────────
// The default stack runs postgres, redis and six Node containers while images
// build in the Docker VM. Report inadequate headroom before a boot is mistaken
// for a broken Dockerfile.
if (dockerUp) {
  const info = spawnSync(
    'docker',
    ['info', '--format', '{{.MemTotal}}\t{{.DockerRootDir}}'],
    { encoding: 'utf8' },
  )
  const [memRaw] = info.stdout.trim().split('\t')
  const gib = Number(memRaw) / 1024 ** 3
  record(
    gib >= 6,
    'docker VM memory',
    gib >= 6
      ? `${gib.toFixed(1)} GiB`
      : `${gib.toFixed(1)} GiB is not enough for postgres + redis + 6 services and their builds — ` +
          'raise it in Docker Desktop > Settings > Resources (8 GiB is comfortable)',
  )

  const df = spawnSync('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}'], {
    encoding: 'utf8',
  })
  const toGb = (s) => {
    const n = Number.parseFloat(s)
    if (Number.isNaN(n)) return 0
    if (/TB/i.test(s)) return n * 1024
    if (/GB/i.test(s)) return n
    if (/MB/i.test(s)) return n / 1024
    return 0
  }
  const used = df.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => sum + toGb(line.split('\t')[1] ?? ''), 0)
  record(
    used < 60,
    'docker disk footprint',
    used < 60
      ? `~${used.toFixed(0)} GB`
      : `~${used.toFixed(0)} GB of images/cache/volumes. Reclaim old local images and ` +
          'builder cache with `docker image prune` and `docker builder prune`',
  )
}

const width = Math.max(...results.map((r) => r.name.length))
for (const { ok, name, detail } of results) {
  process.stdout.write(`${ok ? '✓' : '✗'} ${name.padEnd(width)}  ${detail}\n`)
}

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  process.stdout.write(
    `\n${failed.length} check(s) need attention before booting the stack.\n`,
  )
  process.exit(1)
}
process.stdout.write('\nReady for `pnpm e2e:stack:up`.\n')
