// BQC-6.2 — error-detection injection proof.
//
// Proves the harness (e2e/helpers/error-detection.ts) actually detects what it
// claims to detect by injecting each error class and asserting the collector
// records it: pageerror (uncaught throw + unhandled rejection), console.error,
// a non-2xx critical mutation, and a net-level request failure.
//
// Most tests here use the BASE @playwright/test `test` and drive the collector
// directly — they intentionally inject the exact signals the auto-fail harness
// would fail on, so they must NOT run under the harness fixture. The single
// end-to-end test at the bottom DOES use the harness (`gatedTest`) with
// test.fail(): the harness's own teardown failure becomes a pass, proving the
// gate bites on a real spec.

import { test, expect } from '@playwright/test'
import { attachErrorDetection, test as gatedTest } from './helpers/error-detection'

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
