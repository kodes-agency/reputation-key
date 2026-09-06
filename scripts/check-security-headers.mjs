#!/usr/bin/env node
// BQC-7.6 — booted-artifact security gate (STD-P1-07 closure evidence).
//
// Boots the BUILT production server through its real Node --import monitoring
// preload on an ephemeral port and asserts the full B0.7 security header set — the
// proof STD-P1-07 demands: "Built server serves the full B0.7 header set on
// every response; CI assertion fails when any header is absent."
//
// Why this exists: the original nitro plugin was inert (nitropack v2 API under
// a nitro v3 build, serverDir scanning off — see the STD-P1-07 note on
// server/plugins/security-headers.ts). Static checks cannot prove a runtime
// plugin fired, so this gate verifies against the booted artifact itself:
//
//   1. /api/health/live (200) must carry the full header set.
//   2. an unknown route (404) must carry the same set — "every response"
//      includes error paths.
//   3. an inbound x-request-id is echoed; absent one, the server emits a
//      fresh id (request guard, BQC-7.6).
//   4. a POST whose content-length exceeds REQUEST_BODY_LIMIT_BYTES is
//      rejected 413 before routing (request guard, BQC-7.6).
//
// Secrets are generated randomly per run — never the CI/test placeholder
// family (the production placeholder-secret boot guard refuses those).
//
// Runs after `pnpm build` (CI: ci.yml check job, after the "Web build" step;
// local: `pnpm check:security-headers`). Exits 1 listing every failure.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_ENTRY = join(ROOT, '.output/server/index.mjs')
const PRELOAD_ENTRY = join(ROOT, '.output/server/web-observability-preload.mjs')

const BOOT_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250
// Small limit so the 413 probe stays cheap; the production default (1 MiB)
// lives in src/shared/config/env.ts (REQUEST_BODY_LIMIT_BYTES).
const BODY_LIMIT_BYTES = 1024
const PROBE_UPLOAD_ORIGIN = 'https://uploads.security-probe.repkey.invalid'

// The B0.7 header set, exactly as served in production (HSTS included —
// NODE_ENV=production). The CSP allows the application shell's per-response
// nonce but otherwise matches every directive and trusted origin exactly.
// Source of truth: getSecurityHeaders() in
// src/shared/security/security-headers.ts — keep in sync deliberately; this
// independent encoding is what makes the gate fail on drift.
const EXPECTED_CSP_PATTERN =
  /^default-src 'none'; script-src 'self'(?: 'nonce-[A-Za-z0-9+/_-]+={0,2}')?; style-src 'self' 'unsafe-inline' https:\/\/api\.fontshare\.com https:\/\/fonts\.googleapis\.com; img-src 'self' data: https:; connect-src 'self' https:\/\/uploads\.security-probe\.repkey\.invalid; font-src 'self' https:\/\/cdn\.fontshare\.com https:\/\/fonts\.gstatic\.com; object-src 'none'; frame-src 'none'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'$/

const EXPECTED_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
}

if (!existsSync(SERVER_ENTRY) || !existsSync(PRELOAD_ENTRY)) {
  console.error(
    `[security-headers] serving artifact or monitoring preload not found — run \`pnpm build\` first.`,
  )
  process.exit(1)
}

/** Allocate an ephemeral localhost port for the probe server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const hex = (bytes) => randomBytes(bytes).toString('hex')

/** Complete, schema-valid production env with per-run random secrets. */
function serverEnv(port) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    // Not contacted by the probes (liveness has no database dependency and
    // the database client connects lazily) — pass through CI URL when set.
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
    // The web boot guard inspects the live queue service. CI may expose it
    // under the dedicated variable or the historical REDIS_URL. The cache URL
    // only needs to be a distinct valid endpoint for these liveness-only
    // probes and is never contacted.
    REDIS_URL: 'redis://localhost:6380',
    QUEUE_REDIS_URL:
      process.env.QUEUE_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    BETTER_AUTH_SECRET: hex(32),
    // The server still binds to HOST/PORT above. BETTER_AUTH_URL is the
    // externally visible canonical origin, which is required to be HTTPS in
    // production and need not resolve for these liveness/header probes.
    BETTER_AUTH_URL: 'https://security-probe.repkey.invalid',
    RESEND_API_KEY: `re_probe_${hex(16)}`,
    GOOGLE_CLIENT_ID: `probe-${hex(8)}.apps.googleusercontent.com`,
    GOOGLE_CLIENT_SECRET: `GOCSPX-${hex(16)}`,
    ENCRYPTION_KEY: hex(32),
    OAUTH_STATE_SECRET: hex(32),
    GUEST_SESSION_SALT: hex(16),
    PORTAL_TOKEN_HASH_SECRET: hex(32),
    // Make the probe hermetic even though the real preload loads dotenv in
    // local execution. Production images contain no .env file; this stable
    // origin models the browser upload destination they receive as a variable.
    S3_PRESIGN_ENDPOINT: PROBE_UPLOAD_ORIGIN,
    REQUEST_BODY_LIMIT_BYTES: String(BODY_LIMIT_BYTES),
    LOG_LEVEL: 'warn',
  }
}

function assertHeaders(label, headers, failures) {
  const csp = headers.get('content-security-policy')
  if (csp === null) {
    failures.push(`${label}: missing header content-security-policy`)
  } else if (!EXPECTED_CSP_PATTERN.test(csp)) {
    failures.push(
      `${label}: content-security-policy = ${JSON.stringify(csp)} (unexpected)`,
    )
  }
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    const actual = headers.get(name)
    if (actual === null) {
      failures.push(`${label}: missing header ${name}`)
    } else if (actual !== value) {
      failures.push(
        `${label}: ${name} = ${JSON.stringify(actual)} (expected ${JSON.stringify(value)})`,
      )
    }
  }
}

async function main() {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['--import', PRELOAD_ENTRY, SERVER_ENTRY], {
    cwd: ROOT,
    env: serverEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderrTail = ''
  child.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000)
  })
  let exited = null
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })

  const failures = []
  try {
    // Wait for liveness (fail fast if the process dies during boot).
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    let live = null
    while (Date.now() < deadline) {
      if (exited) break
      try {
        live = await fetch(`${base}/api/health/live`)
        break
      } catch {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    }
    if (!live) {
      failures.push(
        exited
          ? `server exited during boot (code ${exited.code} signal ${exited.signal}):\n${stderrTail}`
          : `server did not answer /api/health/live within ${BOOT_TIMEOUT_MS}ms:\n${stderrTail}`,
      )
    } else {
      // 1. Full header set on the liveness response.
      assertHeaders('GET /api/health/live (200)', live.headers, failures)

      // 2. Same set on an unknown route — error/404 paths are covered too.
      const missing = await fetch(`${base}/bqc-7-6-no-such-route`)
      assertHeaders(
        `GET /bqc-7-6-no-such-route (${missing.status})`,
        missing.headers,
        failures,
      )

      // 3a. Inbound x-request-id is honored (echoed back).
      const probeId = `ci-probe-${hex(8)}`
      const echoed = await fetch(`${base}/api/health/live`, {
        headers: { 'x-request-id': probeId },
      })
      if (echoed.headers.get('x-request-id') !== probeId) {
        failures.push(
          `x-request-id echo: sent ${probeId}, got ${JSON.stringify(echoed.headers.get('x-request-id'))}`,
        )
      }
      // 3b. Absent inbound id, the server emits one on every response.
      const generated = live.headers.get('x-request-id')
      if (!generated || generated.length < 8) {
        failures.push(
          `x-request-id missing/short on response without inbound id: ${JSON.stringify(generated)}`,
        )
      }

      // 4. Body limit: content-length beyond the limit is rejected 413
      // before the route handler runs.
      const oversized = await fetch(`${base}/api/health/live`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(BODY_LIMIT_BYTES * 2) }),
      })
      if (oversized.status !== 413) {
        failures.push(
          `body limit: POST with content-length > ${BODY_LIMIT_BYTES} returned ${oversized.status}, expected 413`,
        )
      } else {
        // The short-circuit response still flows through the response hooks —
        // it must carry the guard/header set like any other response.
        assertHeaders('POST oversized (413)', oversized.headers, failures)
        if (!oversized.headers.get('x-request-id')) {
          failures.push('413 response is missing x-request-id')
        }
      }
    }
  } finally {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((r) => child.once('exit', r)),
      new Promise((r) => setTimeout(r, 5_000)),
    ])
    if (!exited) child.kill('SIGKILL')
  }

  if (failures.length > 0) {
    console.error(`[security-headers] FAILED — ${failures.length} violation(s):`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log(
    `[security-headers] OK — booted artifact serves the full B0.7 set on 200 and 404 responses, ` +
      `echoes/generates x-request-id, and rejects oversized bodies (413).`,
  )
}

main().catch((err) => {
  console.error('[security-headers] unexpected gate error:', err)
  process.exit(1)
})
