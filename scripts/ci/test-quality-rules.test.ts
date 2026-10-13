// The rules of the test-quality gate, run on single lines and on register
// entries written for the purpose. The gate itself
// (scripts/check-test-quality.mjs) applies the same functions to the
// repository; it has to stay plain JavaScript because `pnpm lint:ci` runs it
// with bare Node, so the rules are loaded here as the module they are.

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

type RegisterEntry = Readonly<{
  file: string
  owner: string
  reason: string
  maxHits: number
  runtimeFence?: boolean
  reviewBy?: string
}>

type TestQualityRules = Readonly<{
  TEST_FILE: RegExp
  isSkipSite: (line: string) => boolean
  lineFailures: (line: string, at: string) => readonly string[]
  registerFailures: (
    entries: readonly RegisterEntry[],
    hits: ReadonlyMap<string, number>,
    today: string,
  ) => readonly string[]
}>

const RULES_MODULE = pathToFileURL(
  resolve(import.meta.dirname, '../test-quality-rules.mjs'),
).href
const rules: TestQualityRules = await import(RULES_MODULE)

const AT = 'src/example.test.ts:7'
const TODAY = '2026-10-13'

// The gate reads this file too, one line at a time, so no line here may spell
// what it rejects. Each sample line is put together from these when it runs.
const REJECTS = '.rejects'
const TO_THROW = '.toThrow'
const ONLY = '.only'
const SKIP = '.skip'
const TODO = '.todo'
const RUN_IF = '.runIf'
const SKIP_IF = '.skipIf'
const FIXME = '.fixme'

const entry = (over: Partial<RegisterEntry> = {}): RegisterEntry => ({
  file: 'e2e/parked.spec.ts',
  owner: 'engineering',
  reason: 'the capability this test signs in with is dark',
  maxHits: 1,
  reviewBy: '2027-01-13',
  ...over,
})

const oneHit = new Map([['e2e/parked.spec.ts', 1]])

describe('which files the gate governs', () => {
  it.each([
    'reply.test.ts',
    'button.test.tsx',
    'review-expiry.spec.ts',
    'button.stories.tsx',
    // The Storybook Playwright suites: outside the gate until 2026-10-13.
    'guest-vitals.metrics.ts',
  ])('reads %s', (name) => {
    expect(rules.TEST_FILE.test(name)).toBe(true)
  })

  it.each(['reply.ts', 'metrics.ts', 'web-vitals.ts', 'button.stories.mdx'])(
    'leaves %s alone',
    (name) => {
      expect(rules.TEST_FILE.test(name)).toBe(false)
    },
  )
})

describe('any-error acceptance', () => {
  it.each([
    `    )${REJECTS}.toBeDefined()`,
    `    await expect(save(null))${REJECTS}.toBeDefined()`,
    `    await expect(refusal)${REJECTS}.toBeTruthy()`,
    `    await expect(handler(job))${REJECTS}.toBeInstanceOf(Error)`,
    `    await expect(handler(job))${REJECTS}${TO_THROW}(Error)`,
    `    expect(() => parse(input))${TO_THROW}Error(Error)`,
  ])('fails %s', (line) => {
    expect(rules.lineFailures(line, AT)).toEqual([
      expect.stringContaining(`any-error matcher at ${AT} accepts ANY failure`),
    ])
  })

  it.each([
    "    ).rejects.toMatchObject({ name: 'PortalError', code: 'portal_not_found' })",
    '    await expect(handler(job)).rejects.toBeInstanceOf(UnrecoverableError)',
    "    await expect(refusal).rejects.toThrow('consent_renewal_required')",
    '    await expect(refusal).rejects.toThrow(/policy_unavailable/)',
    // Not a rejection: a value that is merely present is a fair assertion.
    '    expect(row).toBeDefined()',
    '    await expect(read()).resolves.toBeDefined()',
    // Asserting that nothing is thrown is precise.
    '    expect(() => parse(input)).not.toThrow(Error)',
  ])('passes %s', (line) => {
    expect(rules.lineFailures(line, AT)).toEqual([])
  })
})

describe('the rules the gate already had', () => {
  it('fails a focused test in every chained form', () => {
    for (const line of [
      `  it${ONLY}('runs alone', () => {`,
      `  test.concurrent${ONLY}('runs alone', () => {`,
      `describe${ONLY}.each([1, 2])('case %i', () => {`,
    ]) {
      expect(rules.lineFailures(line, AT)).toEqual([
        `focused test (.only) at ${AT} — remove the focus`,
      ])
    }
  })

  it('fails a bare toThrow and a dangling rejects, and nothing else on the line', () => {
    expect(rules.lineFailures(`    expect(() => parse(input))${TO_THROW}()`, AT)).toEqual(
      [expect.stringContaining(`bare ${TO_THROW}() at ${AT}`)],
    )
    expect(rules.lineFailures(`    await expect(run())${REJECTS}`, AT)).toEqual([
      expect.stringContaining(`unasserted async failure at ${AT}`),
    ])
    expect(
      rules.lineFailures('    expect(() => parse(input)).not.toThrow()', AT),
    ).toEqual([])
  })

  it('counts every way a test can be made absent', () => {
    for (const line of [
      `  test${SKIP}('parked', async () => {`,
      `  it${TODO}('later')`,
      `  test${SKIP}(STORYBOOK_STATIC_DIR === null, reason)`,
      `describe${RUN_IF}(pinned)('fenced', () => {`,
      `  it${SKIP_IF}(!pinned)('fenced', () => {`,
      // Playwright's own spelling of a skip, in each form it takes.
      `  test${FIXME}('parked', async ({ page }) => {`,
      `  test.describe${FIXME}('parked', () => {`,
      `    test${FIXME}(browserName === 'webkit', 'not yet')`,
    ]) {
      expect(rules.isSkipSite(line)).toBe(true)
    }
    expect(rules.isSkipSite("  it('runs', () => {")).toBe(false)
  })
})

describe('the skip register', () => {
  it('passes an entry in use, within its count and its review-by date', () => {
    expect(rules.registerFailures([entry()], oneHit, TODAY)).toEqual([])
    // The date itself is still in time: the entry lapses the day after.
    expect(rules.registerFailures([entry({ reviewBy: TODAY })], oneHit, TODAY)).toEqual(
      [],
    )
  })

  it('fails an entry the day after its review-by date', () => {
    expect(
      rules.registerFailures([entry({ reviewBy: '2026-10-12' })], oneHit, TODAY),
    ).toEqual([
      'e2e/parked.spec.ts: skip register entry (owner engineering) passed its review-by date 2026-10-12 — check that its reason still holds, then re-enable the test or move the date',
    ])
  })

  it.each([
    undefined,
    '',
    'next quarter',
    '13-10-2026',
    // The right shape, and no such day. Compared as text these would pass
    // until 2028 and until March.
    '2027-13-45',
    '2027-02-30',
  ])('fails an entry whose review-by date is %j', (reviewBy) => {
    expect(rules.registerFailures([entry({ reviewBy })], oneHit, TODAY)).toEqual([
      expect.stringContaining('has no reviewBy date that exists (YYYY-MM-DD)'),
    ])
  })

  it('asks no date of a runtime fence, which the gate checks on every run', () => {
    expect(
      rules.registerFailures(
        [entry({ runtimeFence: true, reviewBy: undefined })],
        oneHit,
        TODAY,
      ),
    ).toEqual([])
  })

  it('still fails an entry over its count and an entry nothing uses', () => {
    expect(
      rules.registerFailures([entry()], new Map([['e2e/parked.spec.ts', 2]]), TODAY),
    ).toEqual([
      'e2e/parked.spec.ts: 2 skip/todo/skipIf/runIf hits exceed the registered 1 (owner engineering)',
    ])
    expect(rules.registerFailures([entry()], new Map(), TODAY)).toEqual([
      'stale skip/todo/skipIf/runIf register entry: e2e/parked.spec.ts (owner engineering) has no hits — remove the entry',
    ])
  })
})
