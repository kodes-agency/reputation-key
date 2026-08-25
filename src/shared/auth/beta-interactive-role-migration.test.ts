import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'drizzle/0083_beta_interactive_roles.sql'),
  'utf8',
)

describe('beta interactive role migration', () => {
  it('moves non-manager bindings to support resolution and bumps authority version', () => {
    expect(sql).toContain("state = 'support_resolution'")
    expect(sql).toContain('version = binding.version + 1')
    expect(sql).toContain("'staff_user_deferred'")
    expect(sql).toContain("'custom_role_disabled_beta'")
    expect(sql).toContain("NOT IN ('owner', 'admin')")
  })

  it('rejects pending non-manager invitations without deleting identity history', () => {
    expect(sql).toContain('UPDATE invitation')
    expect(sql).toContain("SET status = 'rejected'")
    expect(sql).toContain('role IS NULL')
    expect(sql).not.toMatch(/\bDELETE\b/i)
    expect(sql).not.toMatch(/\bDROP\b/i)
  })
})
