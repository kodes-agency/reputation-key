import { describe, expect, it } from 'vitest'
import { parseEnvironment } from '#/shared/config/env'
import { testEnvironment } from '#/shared/testing/test-environment'
import { createBootstrapRuntimeConfig } from './bootstrap'

const configFor = (overrides: Record<string, string>) =>
  createBootstrapRuntimeConfig(parseEnvironment({ ...testEnvironment({}), ...overrides }))

describe('createBootstrapRuntimeConfig: discovery skip', () => {
  it('skips recently reconciled Properties when push is configured and the switch is on', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: 'projects/p/topics/t' })
        .reviewDiscoverySkipRecentlyReconciled,
    ).toBe(true)
  })

  it('never skips without push: the sweep is then the only path for a new review', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: '' }).reviewDiscoverySkipRecentlyReconciled,
    ).toBe(false)
    expect(configFor({}).reviewDiscoverySkipRecentlyReconciled).toBe(false)
  })

  it('never skips when the kill switch is off, even with push configured', () => {
    expect(
      configFor({
        GBP_PUBSUB_TOPIC: 'projects/p/topics/t',
        REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED: 'false',
      }).reviewDiscoverySkipRecentlyReconciled,
    ).toBe(false)
  })

  it('still carries the discovery interval as before', () => {
    expect(
      configFor({ REVIEW_DISCOVERY_INTERVAL_MINUTES: '30' }).reviewDiscoveryIntervalMs,
    ).toBe(30 * 60 * 1_000)
  })
})

describe('createBootstrapRuntimeConfig: head checks', () => {
  it('runs dark by default', () => {
    expect(configFor({}).reviewHeadChecks).toBe('dark')
  })

  it('follows REVIEW_HEAD_CHECKS', () => {
    expect(configFor({ REVIEW_HEAD_CHECKS: 'off' }).reviewHeadChecks).toBe('off')
    expect(configFor({ REVIEW_HEAD_CHECKS: 'dark' }).reviewHeadChecks).toBe('dark')
  })

  it('is independent of the skip rule: a head check only follows a skipped look', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: '', REVIEW_HEAD_CHECKS: 'dark' }).reviewHeadChecks,
    ).toBe('dark')
    expect(
      configFor({
        GBP_PUBSUB_TOPIC: 'projects/p/topics/t',
        REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED: 'false',
      }).reviewHeadChecks,
    ).toBe('dark')
  })
})
