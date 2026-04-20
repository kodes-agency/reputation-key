/// <reference types="vitest/globals" />

// Test setup — runs before each test suite
import { resetEnv } from '#/shared/config/env'

beforeEach(() => {
  resetEnv()
})
