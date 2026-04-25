/// <reference types="vitest/globals" />

// Test setup — runs before each test suite
import { resetEnv } from '#/shared/config/env'

// Initialize the permission table so can() works in tests.
// This imports the auth permissions module which calls setPermissionTable().
import '#/shared/auth/permissions'

beforeEach(() => {
  resetEnv()
})
