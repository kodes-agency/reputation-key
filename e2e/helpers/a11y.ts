// BQC-6.8 — e2e axe layer.
//
// Injects axe-core into the real app pages (signed-in, enabled workflows) and
// fails on violations — the page-level counterpart to the Storybook a11y gate.
// axe-core is NOT a direct dependency (pnpm strict): it is resolved through
// @storybook/addon-a11y's dependency chain, so the e2e layer always runs the
// exact axe version the Storybook gate runs.
//
// Rule parity with the Storybook gate PLUS the page-structure rules: the
// storybook preview disables landmark-one-main / page-has-heading-one /
// region / landmark-* because isolated component stories have no page shell.
// On REAL pages those rules apply, so this layer runs axe's full default
// rule set (wcag2a/aa + wcag21a/aa + best-practice, which includes the
// landmark/heading rules) — no page-structure rule may be disabled here.
//
// Suppressions go through AXE_SUPPRESSIONS ONLY: rule + page pattern + owner
// + reason, one entry per case. No blanket disables.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { Page, Route } from '@playwright/test'

function axeSourcePath(): string {
  const req = createRequire(import.meta.url)
  const addonPkg = req.resolve('@storybook/addon-a11y/package.json')
  return req.resolve('axe-core/axe.min.js', { paths: [dirname(addonPkg)] })
}

let cachedAxeSource: string | undefined

function axeSource(): string {
  cachedAxeSource ??= readFileSync(axeSourcePath(), 'utf8')
  return cachedAxeSource
}

export type AxeViolationNode = Readonly<{
  target: readonly string[]
  html: string
  failureSummary?: string
}>

export type AxeViolation = Readonly<{
  id: string
  impact: string | null
  description: string
  help: string
  nodes: readonly AxeViolationNode[]
}>

export type AxeSuppression = Readonly<{
  /** axe rule id (e.g. 'color-contrast'). */
  rule: string
  /** Scope: page URL pattern this suppression applies to. */
  page: RegExp
  owner: string
  reason: string
}>

/**
 * The narrow suppression register. Every entry is rule+page scoped with an
 * owner and a reason — an entry that stops matching (rule fixed at root)
 * becomes dead weight and must be removed, keeping the gate honest.
 */
export const AXE_SUPPRESSIONS: ReadonlyArray<AxeSuppression> = []

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

/** Inject axe into the current page document (idempotent per document). */
export async function injectAxe(page: Page): Promise<void> {
  const present = await page.evaluate(() => 'axe' in window)
  if (present) return
  const scriptUrl = new URL('/__e2e__/axe-core.js', page.url()).href
  const serveAxe = (route: Route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: axeSource(),
    })

  await page.route(scriptUrl, serveAxe)
  try {
    // A same-origin external script honors the production CSP without weakening
    // it. Inline/path injection is correctly rejected by the nonce-only policy.
    await page.addScriptTag({ url: scriptUrl })
    await page.waitForFunction(() => 'axe' in window)
  } finally {
    await page.unroute(scriptUrl, serveAxe)
  }
}

/**
 * Settle CSS transitions and animations, then wait a frame.
 *
 * axe reads colours from computed styles at the instant it runs. Buttons carry
 * `transition-all` at 150ms, so a scan that lands mid-transition measures an
 * intermediate colour that was never a rendered resting state. Measured on the
 * property deep-dive: releasing a button's colour back to the inherited
 * `--foreground` produced 11 distinct intermediate values sweeping oklab L
 * 0.80 -> 0.28, and CI once caught one at 3.47:1 on a control whose settled
 * contrast is 18:1.
 *
 * This suppresses nothing real: every resting state is still measured exactly.
 * It only stops the scan from grading frames the user never sees.
 */
async function settleMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
    }`,
  })
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    )
    const { promise, resolve } = Promise.withResolvers<void>()
    requestAnimationFrame(() => resolve())
    await promise
  })
}

/** Run axe on the full page; returns raw violations (suppressions NOT applied). */
export async function runAxe(page: Page): Promise<readonly AxeViolation[]> {
  await injectAxe(page)
  await settleMotion(page)
  return page.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: unknown,
          ) => Promise<{ violations: AxeViolation[] }>
        }
      }
    ).axe
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations'],
      // axe's asset preloader fetches external stylesheets via XHR — the app's
      // font CSS (api.fontshare.com) denies that cross-origin fetch, and the
      // resulting CORS console error trips the e2e error gate. Rule evaluation
      // (incl. color-contrast) works from computed styles without preloaded
      // assets, so the preloader is pure noise here.
      preload: false,
    })
    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        html: n.html.slice(0, 200),
        failureSummary: n.failureSummary,
      })),
    }))
  }, AXE_TAGS)
}

function formatViolations(violations: readonly AxeViolation[]): string {
  return violations
    .map(
      (v, i) =>
        `[${i + 1}] ${v.id} (${v.impact ?? 'unknown'}) — ${v.help}\n` +
        v.nodes
          .map(
            (n) =>
              `    target: ${n.target.join(' ')}\n` +
              `    html: ${n.html}\n` +
              (n.failureSummary
                ? `    ${n.failureSummary.split('\n').join('\n    ')}`
                : ''),
          )
          .join('\n'),
    )
    .join('\n\n')
}

/**
 * Assert the page has zero axe violations after the narrow suppression
 * register. Fails with the full violation report (rule, impact, targets,
 * failure summary) so the fix can go to root.
 */
export async function assertNoAxeViolations(
  page: Page,
  pageLabel: string,
): Promise<void> {
  const violations = await runAxe(page)
  const pageUrl = page.url()
  const unsuppressed: AxeViolation[] = []
  const suppressed: AxeViolation[] = []
  for (const v of violations) {
    const match = AXE_SUPPRESSIONS.find((s) => s.rule === v.id && s.page.test(pageUrl))
    if (match) suppressed.push(v)
    else unsuppressed.push(v)
  }
  if (suppressed.length > 0) {
    console.info(
      `[a11y] ${pageLabel}: ${suppressed.length} violation(s) covered by registered suppressions: ${suppressed.map((v) => v.id).join(', ')}`,
    )
  }
  if (unsuppressed.length > 0) {
    throw new Error(
      `axe found ${unsuppressed.length} accessibility violation(s) on ${pageLabel} (${pageUrl}):\n\n` +
        `${formatViolations(unsuppressed)}\n\n` +
        'Fix at root. If a violation is a verified false positive, register a NARROW suppression (rule + page + owner + reason) in e2e/helpers/a11y.ts.',
    )
  }
}
