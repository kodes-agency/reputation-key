import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readPopulatedUpgradeFixture } from './populated-upgrade-fixture'

const archive = readFileSync('test-fixtures/populated-upgrade/two-tenant.sql.gz')

describe('pinned populated upgrade fixture', () => {
  it('retains the captured two-tenant database, including its released journal', () => {
    const sql = readPopulatedUpgradeFixture(archive)
    const copyRows = (table: string) =>
      sql
        .split(`COPY ${table} `)[1]!
        .split('\n')
        .slice(1)
        .join('\n')
        .split('\\.')[0]!
        .trim()
        .split('\n')
    expect(copyRows('drizzle.__drizzle_migrations')).toHaveLength(94)
    expect(copyRows('public.organization').map((row) => row.split('\t')[0])).toEqual([
      'sim-ci-org',
      'sim-org-2-1793846908838',
    ])
    expect(copyRows('public.properties')).toHaveLength(3)
    expect(copyRows('public.reviews')).toHaveLength(13)
    expect(copyRows('public.replies')).toHaveLength(3)
  })

  it('refuses replacement bytes before any SQL is restored', () => {
    const changed = Buffer.from(archive)
    changed[20] = changed[20]! ^ 1
    expect(() => readPopulatedUpgradeFixture(changed)).toThrow('fixture digest')
  })

  it('removes only restriction command lines after verifying the captured dump', () => {
    const original = gunzipSync(archive).toString('utf8')
    const lines = original.split('\n')
    const restrictionLines = lines.filter((line) => /^\\(?:un)?restrict\s/.test(line))
    expect(restrictionLines).toHaveLength(2)
    const sql = readPopulatedUpgradeFixture(archive)
    expect(sql.includes(restrictionLines[0]!)).toBe(false)
    expect(sql.includes(restrictionLines[1]!)).toBe(false)
    expect(sql.split('\n')).toEqual(
      lines.filter((line) => !restrictionLines.includes(line)),
    )
  })
})
