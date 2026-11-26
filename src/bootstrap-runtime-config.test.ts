import { describe, expect, it } from 'vitest'
import { parseEnvironment } from '#/shared/config/env'
import { testEnvironment } from '#/shared/testing/test-environment'
import { createBootstrapRuntimeConfig } from './bootstrap'

const configFor = (overrides: Record<string, string>) =>
  createBootstrapRuntimeConfig(parseEnvironment({ ...testEnvironment({}), ...overrides }))

describe('createBootstrapRuntimeConfig: discovery skip', () => {
  it('skips recently reconciled Properties when push is configured and the switch is on', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: 'projects/p/topics/t' }).review
        .discoverySkipRecentlyReconciled,
    ).toBe(true)
  })

  it('never skips without push: the sweep is then the only path for a new review', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: '' }).review.discoverySkipRecentlyReconciled,
    ).toBe(false)
    expect(configFor({}).review.discoverySkipRecentlyReconciled).toBe(false)
  })

  it('never skips when the kill switch is off, even with push configured', () => {
    expect(
      configFor({
        GBP_PUBSUB_TOPIC: 'projects/p/topics/t',
        REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED: 'false',
      }).review.discoverySkipRecentlyReconciled,
    ).toBe(false)
  })

  it('still carries the discovery interval as before', () => {
    expect(
      configFor({ REVIEW_DISCOVERY_INTERVAL_MINUTES: '30' }).review.discoveryIntervalMs,
    ).toBe(30 * 60 * 1_000)
  })
})

describe('createBootstrapRuntimeConfig: head checks', () => {
  it('runs dark by default', () => {
    expect(configFor({}).review.headChecks).toBe('dark')
  })

  it('follows REVIEW_HEAD_CHECKS', () => {
    expect(configFor({ REVIEW_HEAD_CHECKS: 'off' }).review.headChecks).toBe('off')
    expect(configFor({ REVIEW_HEAD_CHECKS: 'dark' }).review.headChecks).toBe('dark')
    expect(configFor({ REVIEW_HEAD_CHECKS: 'persist' }).review.headChecks).toBe('persist')
  })

  it('is independent of the skip rule: a head check only follows a skipped look', () => {
    expect(
      configFor({ GBP_PUBSUB_TOPIC: '', REVIEW_HEAD_CHECKS: 'dark' }).review.headChecks,
    ).toBe('dark')
    expect(
      configFor({
        GBP_PUBSUB_TOPIC: 'projects/p/topics/t',
        REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED: 'false',
      }).review.headChecks,
    ).toBe('dark')
  })
})

describe('createBootstrapRuntimeConfig: reconciliation window', () => {
  it('is six hours by default, in milliseconds', () => {
    expect(configFor({}).review.reconcileWithinMs).toBe(6 * 60 * 60 * 1_000)
  })

  it('follows REVIEW_RECONCILE_WITHIN_HOURS', () => {
    expect(
      configFor({ REVIEW_RECONCILE_WITHIN_HOURS: '24' }).review.reconcileWithinMs,
    ).toBe(24 * 60 * 60 * 1_000)
  })

  it('accepts fourteen days and refuses one hour more', () => {
    expect(
      configFor({ REVIEW_RECONCILE_WITHIN_HOURS: '336' }).review.reconcileWithinMs,
    ).toBe(336 * 60 * 60 * 1_000)
    expect(() => configFor({ REVIEW_RECONCILE_WITHIN_HOURS: '337' })).toThrow(
      'REVIEW_RECONCILE_WITHIN_HOURS',
    )
  })
})
