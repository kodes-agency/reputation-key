import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { probeFinalGoogleImportSchema } from './google-import-final-schema-probe'

describe('final Google import schema probe', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('executes the four contract-safe reads used by final release images', async () => {
    await expect(probeFinalGoogleImportSchema(lease.pool)).resolves.toEqual({
      status: 'ok',
      checks: 4,
    })
  })
})
