// Tests for Sentry setup
import { describe, it, expect } from 'vitest'
import { initSentry } from './errors'

describe('initSentry', () => {
  it('does not throw when called', () => {
    // initSentry reads SENTRY_DSN from env. If not set, it's a no-op.
    // If set, it's still a no-op in Phase 4 (stub).
    expect(() => initSentry()).not.toThrow()
  })
})
