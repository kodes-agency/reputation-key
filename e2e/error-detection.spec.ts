// BQC-6.2 — error-detection injection proof.
//
// Proves the harness (e2e/helpers/error-detection.ts) actually detects what it
// claims to detect, by INJECTING each error class and asserting the collector
// records it:
//   pageerror (uncaught throw + unhandled rejection), console.error, non-2xx
//   critical mutation, net-level request failure, allowlist suppression, and
//   allowlist expiry.
//
// Most tests here use the BASE @playwright/test `test` and drive the collector
// directly — they intentionally inject the exact signals the auto-fail harness
// would fail on, so they must NOT run under the harness fixture. The single
// end-to-end test at the bottom DOES use the harness (`gatedTest`) with
// test.fail(): the harness's own teardown failure becomes a pass, proving the
// gate bites on a real spec.

import { test, expect } from '@playwright/test'
import {
  attachErrorDetection,
  isAllowlistEntryExpired,
  test as gatedTest,
} from './helpers/error-detection'
import { ERROR_ALLOWLIST, type AllowlistEntry } from './helpers/error-allowlist'

function probeEntry(overrides: Partial<AllowlistEntry>): AllowlistEntry {
  return {
    id: 'probe-entry',
    kind: 'console-error',
    pattern: 'e2e-probe',
    owner: 'engineering',
    reason: 'injection proof entry — never shipped',
    expires: '2099-01-01',
    ...overrides,
  }
}

test.describe('error detection — collector injection proof', () => {
  test('captures pageerror from an uncaught exception', async ({ page }) => {
    const collector = attachErrorDetection(page)
    // Throw via setTimeout so it escapes the evaluate promise and surfaces as
    // a genuine uncaught pageerror, not an evaluate rejection.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('injected pageerror')
      }, 0)
    })
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'pageerror').length)
      .toBe(1)
    const detection = collector.detections[0]
    expect(detection.message).toContain('injected pageerror')
    expect(detection.stack).toContain('injected pageerror')
    collector.detach()
  })

  test('captures pageerror from an unhandled promise rejection', async ({ page }) => {
    const collector = attachErrorDetection(page)
    await page.evaluate(() => {
      setTimeout(() => {
        void Promise.reject(new Error('injected unhandled rejection'))
      }, 0)
    })
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'pageerror').length)
      .toBe(1)
    expect(collector.detections[0].message).toContain('injected unhandled rejection')
    collector.detach()
  })

  test('captures unexpected console.error output', async ({ page }) => {
    const collector = attachErrorDetection(page)
    await page.evaluate(() => console.error('injected console error'))
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'console-error').length)
      .toBe(1)
    expect(collector.detections[0].message).toContain('injected console error')
    collector.detach()
  })

  test('captures a non-2xx critical mutation (POST /_server)', async ({ page }) => {
    await page.goto('/')
    const collector = attachErrorDetection(page)
    await page.route('**/_server/e2e-probe*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
    // page.request would NOT emit page events — drive a real browser fetch.
    await page.evaluate(() =>
      fetch('/_server/e2e-probe', { method: 'POST' }).then(() => undefined),
    )
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'mutation-status').length)
      .toBe(1)
    const detection = collector.detections[0]
    expect(detection.message).toContain('POST')
    expect(detection.message).toContain('/_server/e2e-probe')
    expect(detection.message).toContain('500')
    collector.detach()
  })

  test('captures a net-level failure on a critical mutation path', async ({ page }) => {
    await page.goto('/')
    const collector = attachErrorDetection(page)
    await page.route('**/_server/e2e-probe*', (route) => route.abort())
    await page.evaluate(() =>
      fetch('/_server/e2e-probe', { method: 'POST' }).catch(() => undefined),
    )
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'request-failed').length)
      .toBe(1)
    expect(collector.detections[0].message).toContain('/_server/e2e-probe')
    collector.detach()
  })

  test('a live allowlist entry suppresses its console.error match', async ({ page }) => {
    const collector = attachErrorDetection(page, {
      extraAllowlist: [probeEntry({ pattern: 'e2e-probe benign console output' })],
    })
    await page.evaluate(() => console.error('e2e-probe benign console output'))
    // Negative assertion: give the console event a window to (not) arrive.
    await page.evaluate(() => null)
    await page.waitForTimeout(250)
    expect(collector.detections).toHaveLength(0)
    await collector.assertEmpty()
    collector.detach()
  })

  test('React "Failed to fetch" route-match echo is gated WITHOUT a GET abort', async ({
    page,
  }) => {
    const collector = attachErrorDetection(page)
    await page.evaluate(() =>
      console.error(
        'TypeError: Failed to fetch\nThe above error occurred in the <MatchInnerImpl> component',
      ),
    )
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'console-error').length)
      .toBe(1)
    collector.detach()
  })

  test('React "Failed to fetch" echo after a GET abort is navigation noise', async ({
    page,
  }) => {
    await page.goto('/')
    const collector = attachErrorDetection(page)
    // Hold the GET in flight, then abort it client-side (net::ERR_ABORTED) —
    // the same signature TanStack Router's navigation AbortSignal produces.
    await page.route('**/slow-get-probe', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.evaluate(() => {
      const controller = new AbortController()
      void fetch('/slow-get-probe', { signal: controller.signal }).catch(() => undefined)
      setTimeout(() => controller.abort(), 100)
    })
    await page.waitForTimeout(500)
    await page.evaluate(() =>
      console.error(
        'TypeError: Failed to fetch\nThe above error occurred in the <MatchInnerImpl> component',
      ),
    )
    await page.evaluate(() => null)
    await page.waitForTimeout(250)
    expect(collector.detections).toHaveLength(0)
    collector.detach()
  })

  test('a deliberate document 404 is not re-reported through the console', async ({
    page,
  }) => {
    // A route that fails closed (portal detail's `notFound()`) answers the
    // NAVIGATION with 404, and Chromium logs that as a network error. The
    // status is the spec's to assert off page.goto(); the echo is noise.
    await page.route('**/e2e-probe-denied-document', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<html><body><p>denied</p></body></html>',
      }),
    )
    const collector = attachErrorDetection(page)
    const response = await page.goto('/e2e-probe-denied-document')
    expect(response?.status()).toBe(404)
    await page.waitForTimeout(500)
    expect(collector.detections).toHaveLength(0)
    await collector.assertEmpty()
    collector.detach()
  })

  test('a 404 SUBRESOURCE still fails the gate on a 404 document', async ({ page }) => {
    // The sharp edge of document-status correlation: same status, same page,
    // different url. Only the document's echo may be suppressed — a broken
    // subresource must survive, or the correlation would be a blanket 404
    // amnesty for every page that legitimately 404s.
    await page.route('**/e2e-probe-denied-document', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<html><body><p>denied</p></body></html>',
      }),
    )
    await page.route('**/e2e-probe-missing-asset', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }),
    )
    const collector = attachErrorDetection(page)
    await page.goto('/e2e-probe-denied-document')
    await page.evaluate(() => fetch('/e2e-probe-missing-asset').catch(() => undefined))
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'console-error').length)
      .toBe(1)
    expect(collector.detections[0].message).toContain('status of 404')
    collector.detach()
  })

  test('an expired allowlist entry does NOT suppress — detection fails', async ({
    page,
  }) => {
    const expired = probeEntry({
      pattern: 'e2e-probe expired entry',
      expires: '2020-01-01',
    })
    expect(isAllowlistEntryExpired(expired)).toBe(true)
    const collector = attachErrorDetection(page, { extraAllowlist: [expired] })
    await page.evaluate(() => console.error('e2e-probe expired entry'))
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'console-error').length)
      .toBe(1)
    await expect(collector.assertEmpty()).rejects.toThrow(/e2e-probe expired entry/)
    collector.detach()
  })

  test('a page-scoped pageerror entry suppresses only on its page', async ({ page }) => {
    const scoped = probeEntry({
      kind: 'pageerror',
      pattern: /^injected pageerror$/,
      pagePattern: 'about:blank',
    })
    const collector = attachErrorDetection(page, { extraAllowlist: [scoped] })
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('injected pageerror')
      }, 0)
    })
    await page.evaluate(() => null)
    await page.waitForTimeout(250)
    expect(collector.detections).toHaveLength(0)
    collector.detach()
  })

  test('an UNSCOPED pageerror entry never matches (fail-closed)', async ({ page }) => {
    const unscoped = probeEntry({ kind: 'pageerror', pattern: /injected pageerror/ })
    const collector = attachErrorDetection(page, { extraAllowlist: [unscoped] })
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('injected pageerror')
      }, 0)
    })
    await expect
      .poll(() => collector.detections.filter((d) => d.kind === 'pageerror').length)
      .toBe(1)
    collector.detach()
  })

  test('shipped allowlist entries are owned, reasoned, and unexpired', () => {
    for (const entry of ERROR_ALLOWLIST) {
      expect(entry.id, 'id').toMatch(/^[a-z0-9-]+$/)
      expect(entry.owner.trim().length, `${entry.id} owner`).toBeGreaterThan(0)
      expect(entry.reason.trim().length, `${entry.id} reason`).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(entry.expires)), `${entry.id} expires parses`).toBe(
        false,
      )
      expect(isAllowlistEntryExpired(entry), `${entry.id} is unexpired`).toBe(false)
      if (entry.kind === 'mutation-status') {
        expect(entry.status, `${entry.id} status is scoped`).toBeDefined()
      }
      if (entry.kind === 'pageerror') {
        expect(entry.pagePattern, `${entry.id} pagePattern is required`).toBeDefined()
      }
    }
  })
})

// ── End-to-end gate proof ──────────────────────────────────────────
// This ONE test runs under the real harness. It injects a console.error and
// makes no assertions: the harness page-fixture teardown MUST fail the test,
// and test.fail() inverts that expected failure into a pass. If the gate ever
// stops biting, this test goes red ("expected to fail, but passed").
gatedTest.describe('error detection — end-to-end gate proof (injection)', () => {
  gatedTest(
    'harness fails a test whose page emits an unexpected console.error',
    async ({ page }) => {
      gatedTest.fail()
      await page.evaluate(() => console.error('e2e-probe end-to-end gate trip'))
      // Flush the CDP console event before teardown: a second evaluate
      // round-trip orders after the consoleAPICalled event on the session.
      await page.evaluate(() => null)
      await page.waitForTimeout(100)
    },
  )
})
