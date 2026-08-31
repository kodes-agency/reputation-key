import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCHEMA_ROOT = resolve(import.meta.dirname, 'schema')
const DEPRECATED_OBJECT_EXTRA_CONFIG = /\(t\)\s*=>\s*\(\{/u

describe('Drizzle PostgreSQL schema extra config', () => {
  it('uses the supported array callback syntax in every schema module', () => {
    const violations = globSync('**/*.ts', { cwd: SCHEMA_ROOT }).filter((relativePath) =>
      DEPRECATED_OBJECT_EXTRA_CONFIG.test(
        readFileSync(resolve(SCHEMA_ROOT, relativePath), 'utf8'),
      ),
    )

    expect(violations).toEqual([])
  })
})
