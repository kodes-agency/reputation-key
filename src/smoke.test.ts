// Smoke test — verifies that the app can import and the env schema works
import { describe, expect, it } from 'vitest'

describe('smoke test', () => {
  it('can import shared config module', async () => {
    const mod = await import('#/shared/config/env')
    expect(mod).toBeDefined()
    expect(mod.getEnv).toBeTypeOf('function')
  })

  it('env schema validates required fields', async () => {
    // The test env is set up in vitest.config.ts
    const { getEnv } = await import('#/shared/config/env')
    const env = getEnv()
    expect(env.NODE_ENV).toBe('test')
    expect(env.DATABASE_URL).toContain('postgresql://')
  })
})
