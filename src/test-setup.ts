import { beforeAll, beforeEach } from 'vitest'
import '#/shared/auth/permissions'
import { resetEnv } from '#/shared/config/env'

// Tests that construct the container scrub the provider/security env groups
// themselves: see src/shared/testing/clear-container-env.ts.
resetEnv()

beforeAll(() => {
  resetEnv()
})

beforeEach(() => {
  resetEnv()
})
