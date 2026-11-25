import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { providerSourceAdvisoryScope } from './provider-source-advisory-scope.server'

const ORG = '00000000-0000-4000-8000-000000000001'
const PROPERTY = '00000000-0000-4000-8000-000000000002'
const NATIVE_ORG = 'better-auth-org_01'

describe('providerSourceAdvisoryScope', () => {
  it('keeps the bytes the lock key has always been taken over', () => {
    expect(providerSourceAdvisoryScope(ORG, PROPERTY, 7)).toBe(
      `provider-source|${ORG}|${PROPERTY}|7`,
    )
    expect(providerSourceAdvisoryScope(NATIVE_ORG, PROPERTY, 8)).toBe(
      `provider-source|${NATIVE_ORG}|${PROPERTY}|8`,
    )
    expect(providerSourceAdvisoryScope(ORG, PROPERTY, 0)).toBe(
      `provider-source|${ORG}|${PROPERTY}|0`,
    )
  })

  it('refuses a bad epoch, organization identifier or property id', () => {
    expect(() => providerSourceAdvisoryScope(ORG, PROPERTY, -1)).toThrow(/epoch/)
    expect(() => providerSourceAdvisoryScope(ORG, PROPERTY, 1.5)).toThrow(/epoch/)
    expect(() =>
      providerSourceAdvisoryScope(ORG, PROPERTY, Number.MAX_SAFE_INTEGER + 1),
    ).toThrow(/epoch/)
    expect(() =>
      providerSourceAdvisoryScope('ABCDEFAB-0000-4000-8000-000000000001', PROPERTY, 1),
    ).toThrow(/organization identifier/)
    expect(() => providerSourceAdvisoryScope('unsafe|organization', PROPERTY, 1)).toThrow(
      /organization identifier/,
    )
    expect(() => providerSourceAdvisoryScope(ORG, 'not-a-uuid', 1)).toThrow(/property/)
  })
})

describe('what PostgreSQL hashes for an advisory lock', () => {
  it('is the bare scope with seed 0', () => {
    const sql = readFileSync(
      new URL('../../../shared/db/db-constructs.sql', import.meta.url),
      'utf8',
    )
    const definition =
      /FUNCTION public\.ai_advisory_lock_key_v1\(p_lock_key text\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/u.exec(
        sql,
      )
    expect(definition?.[1]?.trim()).toBe('SELECT hashtextextended(p_lock_key, 0)')
  })
})
