#!/usr/bin/env node
// `pnpm local:doctor` — the preflight for anything that boots the local stack.
//
// Every check here comes from a failure that actually cost a debugging cycle:
//   - wrong Node major: the stack orchestrator fails ENOBUFS mid-boot, after the
//     containers are up, and `e2e:stack:down` then cannot clean up either.
//   - Docker not running / crashed: the compose build dies with
//     "rpc error: code = Unavailable desc = error reading from server: EOF",
//     which reads like a broken Dockerfile.
//   - port already bound: web binds 127.0.0.1:3000, so any other dev server on
//     3000 makes the stack unstartable, and the error surfaces as an unhealthy
//     container rather than a port conflict.
//
// Read-only: it inspects, reports, and exits non-zero. It never stops a process,
// frees a port, or starts Docker — those are the developer's call.

import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Host ports the e2e stack publishes (src/shared/testing/local-stack-controller.ts). */
const REQUIRED_PORTS = [
  { port: 3000, who: 'web' },
  { port: 3001, who: 'web-locked' },
  { port: 55432, who: 'postgres' },
  { port: 56379, who: 'redis' },
  { port: 58443, who: 'google-egress-gateway' },
]

const results = []
const record = (ok, name, detail) => results.push({ ok, name, detail })

// ── runtime ────────────────────────────────────────────────────────────
const pinned = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()
const runtime = { node: pinned, icu: '78.2', unicode: '17.0' }
const drift = Object.entries(runtime).filter(([k, v]) => process.versions[k] !== v)
record(
  drift.length === 0,
  `runtime pinned to node ${pinned}`,
  drift.length === 0
    ? `node ${process.versions.node} / icu ${process.versions.icu}`
    : drift
        .map(([k, v]) => `${k} expected ${v}, running ${process.versions[k]}`)
        .join('; ') + ' — run `fnm use` (or `nvm use`) in the repo root',
)

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
  const stale = spawnSync(
    'docker',
    ['ps', '-aq', '--filter', 'name=repkey-e2e', '--filter', 'name=repkey-beta'],
    { encoding: 'utf8' },
  )
  const count = stale.stdout.trim() ? stale.stdout.trim().split('\n').length : 0
  record(
    count === 0,
    'no stale stack containers',
    count === 0
      ? 'clean'
      : `${count} left over — \`pnpm e2e:stack:down\` (or \`local:beta:down\`)`,
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
