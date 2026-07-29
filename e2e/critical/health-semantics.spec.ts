// BQC-7.2 — health semantics, hard CI gate (critical project).
//
// Pins the per-endpoint contract against the dev server:
//   /api/health/live     200, dependency-free (fast — no probe budgets)
//   /api/health/ready    200 in the healthy rig, all four probe fields true
//                        (db, redis, migrations, policy); worker heartbeat
//                        deliberately NOT an input
//   /api/health          same upgraded readiness semantics (legacy route)
//   /api/health/started  200 once booted (container + migrations + policy) —
//                        the platform activation gate (railway.json)
//   /api/health/metrics  PRIVATE: 404 without a token, 404 with a wrong token
//                        (never 403 — existence is not revealed), 200 with
//                        OPS_METRICS_TOKEN; identifier-only payload (no PII)
//
// The webServer floor provides the deterministic OPS_METRICS_TOKEN via the
// BQC-6.1 test-environment builder; an explicit shell value wins there, so
// the spec mirrors that precedence.

import { test, expect } from '../helpers/error-detection'
import { DEFAULT_TEST_OPS_METRICS_TOKEN } from '../../src/shared/testing/test-environment'
import { readE2eSeedState } from '../helpers/seed-state'

const OPS_TOKEN = process.env.OPS_METRICS_TOKEN ?? DEFAULT_TEST_OPS_METRICS_TOKEN

test.describe('Critical: health semantics (BQC-7.2)', () => {
  test('liveness is 200 and fast (no dependency checks)', async ({ request }) => {
    // First hit warms the dev server's on-demand route compilation; the
    // TIMED second hit is the semantic: liveness never waits on probe
    // budgets (READINESS_PROBE_BUDGET_MS is 2s per probe).
    await request.get('/api/health/live')
    const start = Date.now()
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
    expect(Date.now() - start).toBeLessThan(1500)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
  })

  test('readiness is 200 with all four probes true in the healthy rig', async ({
    request,
  }) => {
    const res = await request.get('/api/health/ready')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'ok',
      db: true,
      redis: true,
      migrations: true,
      policy: true,
    })
  })

  test('combined legacy endpoint carries the same upgraded semantics', async ({
    request,
  }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'ok',
      db: true,
      redis: true,
      migrations: true,
      policy: true,
    })
  })

  test('startup is 200 once booted (container + migrations + policy)', async ({
    request,
  }) => {
    const res = await request.get('/api/health/started')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'ok',
      container: true,
      migrations: true,
      policy: true,
    })
  })

  test('metrics 404s without/with a wrong token and serves the operator token', async ({
    request,
  }) => {
    // Fail-closed matrix — 404 (NOT 403) in every denial path so probing
    // clients cannot learn the endpoint exists.
    expect((await request.get('/api/health/metrics')).status()).toBe(404)
    expect(
      (
        await request.get('/api/health/metrics', {
          headers: { 'x-ops-token': 'wrong-token' },
        })
      ).status(),
    ).toBe(404)
    expect(
      (
        await request.get('/api/health/metrics', {
          headers: { authorization: 'Bearer wrong-token' },
        })
      ).status(),
    ).toBe(404)

    for (const headers of [
      { 'x-ops-token': OPS_TOKEN },
      { authorization: `Bearer ${OPS_TOKEN}` },
    ]) {
      const res = await request.get('/api/health/metrics', { headers })
      expect(res.status()).toBe(200)
      expect(res.headers()['cache-control']).toContain('no-store')
    }
  })

  test('metrics payload is identifier-only (no content, no PII)', async ({ request }) => {
    const res = await request.get('/api/health/metrics', {
      headers: { 'x-ops-token': OPS_TOKEN },
    })
    expect(res.status()).toBe(200)
    const text = await res.text()

    // OperationsSnapshot shape (5.5): queues + worker heartbeat + degraded list.
    const body = JSON.parse(text)
    expect(Array.isArray(body.queues)).toBe(true)
    expect(body.workers).toHaveProperty('heartbeat')
    expect(Array.isArray(body.degraded)).toBe(true)

    // ADR 0030: no review text, no e-mail addresses — spot-checked against
    // the seeded account/property values plus a generic e-mail pattern.
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
    const seed = readE2eSeedState()
    if (seed) {
      expect(text).not.toContain(seed.email)
      expect(text).not.toContain(seed.propertyName)
    }
  })
})
