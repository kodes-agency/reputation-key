import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runContainerImagePolicyCli } from './check-container-image-policy'
import {
  parseGrypeExceptions,
  validateGrypeExceptionExpiry,
} from './grype-exception-expiry'

const ROOT = resolve(import.meta.dirname, '../..')
const COMMITTED = readFileSync(resolve(ROOT, '.grype.yaml'), 'utf8')
const DAY_MS = 24 * 60 * 60 * 1000

/** Two sections, shaped like the committed file: comment block, then its rules. */
const SAMPLE = `# header prose mentioning expiresAt, which is not a rule
ignore:
  # ── perl-base (2 CVEs) ─────────────────────────────
  # owner: platform — reason: won't-fix on trixie; nothing runs perl.
  # expiresAt: 2026-12-07
  - vulnerability: CVE-2026-0001 # not-fixed
  - vulnerability: CVE-2026-0002 # wont-fix
  # CVE-2026-0003 (added later): no fixed version. expiresAt: 2026-11-15
  - vulnerability: CVE-2026-0003

  # ── gcc-14 runtime libraries ───────────────────────
  # owner: platform — reason: no fixed package on trixie.
  # expiresAt: 2026-10-17
  - vulnerability: CVE-2026-0004
    package:
      version: 14.2.0-19
      type: deb
  - package:
      name: stdlib
      version: go1.20.7
      type: go-module
`

describe('grype exception expiry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads each rule with the expiry of the comment block directly above it', () => {
    expect(
      parseGrypeExceptions(SAMPLE).map(({ rule, expiresAt }) => [rule, expiresAt]),
    ).toEqual([
      ['CVE-2026-0001', '2026-12-07'],
      ['CVE-2026-0002', '2026-12-07'],
      ['CVE-2026-0003', '2026-11-15'],
      ['CVE-2026-0004 (14.2.0-19)', '2026-10-17'],
      ['stdlib go1.20.7', '2026-10-17'],
    ])
  })

  it('passes through the last day an exception is valid', () => {
    expect(validateGrypeExceptionExpiry(SAMPLE, '2026-10-17')).toEqual([])
  })

  it('fails the day after, naming every rule the expired block covers', () => {
    expect(validateGrypeExceptionExpiry(SAMPLE, '2026-10-18')).toEqual([
      '.grype.yaml:14 exception(s) for CVE-2026-0004 (14.2.0-19), stdlib go1.20.7 EXPIRED on 2026-10-17 — remove them with the fix, or renew them with a fresh reason and date',
    ])
    expect(validateGrypeExceptionExpiry(SAMPLE, '2026-12-08')).toHaveLength(3)
  })

  it('fails a rule whose comment block names no date', () => {
    const undated = SAMPLE.replace('  # expiresAt: 2026-10-17\n', '')

    expect(validateGrypeExceptionExpiry(undated, '2026-10-01')).toEqual([
      '.grype.yaml:13 exception(s) for CVE-2026-0004 (14.2.0-19), stdlib go1.20.7 carry no valid "expiresAt: YYYY-MM-DD" in the comment directly above them',
    ])
  })

  it('does not let a rule borrow the date of an earlier section', () => {
    const detached = `${SAMPLE}\n  - vulnerability: CVE-2026-0005\n`

    expect(validateGrypeExceptionExpiry(detached, '2026-10-01')).toEqual([
      '.grype.yaml:23 exception(s) for CVE-2026-0005 carry no valid "expiresAt: YYYY-MM-DD" in the comment directly above them',
    ])
  })

  it('fails a date that is not a calendar day, or a block with two dates', () => {
    const impossible = SAMPLE.replace('expiresAt: 2026-10-17', 'expiresAt: 2026-13-45')
    const twoDates = SAMPLE.replace(
      '# expiresAt: 2026-10-17',
      '# expiresAt: 2026-10-17, was expiresAt: 2026-09-01',
    )

    expect(validateGrypeExceptionExpiry(impossible, '2026-10-01')).toEqual([
      '.grype.yaml:14 exception(s) for CVE-2026-0004 (14.2.0-19), stdlib go1.20.7 carry no valid "expiresAt: YYYY-MM-DD" in the comment directly above them',
    ])
    expect(validateGrypeExceptionExpiry(twoDates, '2026-10-01')).toEqual([
      '.grype.yaml:14 exception(s) for CVE-2026-0004 (14.2.0-19), stdlib go1.20.7 name more than one expiresAt in the comment directly above them',
    ])
  })

  it('reads only the ignore list, not a list under another key', () => {
    const withExclude = `${SAMPLE}exclude:\n  - './vendor/**'\n`

    expect(parseGrypeExceptions(withExclude)).toHaveLength(5)
    expect(validateGrypeExceptionExpiry(withExclude, '2026-10-01')).toEqual([])
  })

  it('accepts a file with no ignore rules at all', () => {
    expect(validateGrypeExceptionExpiry('# zero exceptions\n', '2026-10-01')).toEqual([])
    expect(validateGrypeExceptionExpiry('ignore: []\n', '2026-10-01')).toEqual([])
  })

  it('finds a dated comment above every rule in the committed .grype.yaml', () => {
    const exceptions = parseGrypeExceptions(COMMITTED)

    expect(exceptions.length).toBeGreaterThan(0)
    expect(exceptions.filter(({ expiresAt }) => expiresAt === null)).toEqual([])
  })

  it('passes the container image gate through the first committed expiry, then fails', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const earliest = parseGrypeExceptions(COMMITTED)
      .map(({ expiresAt }) => expiresAt ?? '')
      .sort()
      .at(0)
    const dayAfter = new Date(Date.parse(`${earliest}T00:00:00Z`) + DAY_MS)
      .toISOString()
      .slice(0, 10)

    expect(runContainerImagePolicyCli([ROOT], String(earliest))).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toContain(
      `no scan exception past its expiry on ${earliest}`,
    )
    expect(runContainerImagePolicyCli([ROOT], dayAfter)).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toContain(`EXPIRED on ${earliest}`)
  })
})
