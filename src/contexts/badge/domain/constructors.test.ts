// Badge context — domain constructor unit tests

import { describe, it, expect } from 'vitest'
import { createBadgeDefinition, normalizeBadgeCriteria } from './constructors'
import type { BadgeCriteria, BadgeSeedDefinitionInput } from './types'

const fixedDate = new Date('2026-06-15T12:00:00Z')
const clock = () => fixedDate

const validCriteria: BadgeCriteria = {
  type: 'threshold',
  metricKey: 'portal.scan',
  operator: '>=',
  threshold: 100,
}

const validInput: BadgeSeedDefinitionInput = {
  key: 'scan_master',
  name: 'Scan Master',
  description: 'Awarded for reaching 100 scans',
  icon: 'scan-icon',
  targetScope: 'portal',
  criteria: validCriteria,
}

describe('createBadgeDefinition', () => {
  it('creates a badge definition with required fields', () => {
    const badge = createBadgeDefinition(validInput, clock)

    expect(badge.key).toBe('scan_master')
    expect(badge.name).toBe('Scan Master')
    expect(badge.description).toBe('Awarded for reaching 100 scans')
    expect(badge.icon).toBe('scan-icon')
    expect(badge.targetScope).toBe('portal')
    expect(badge.criteria).toEqual(validCriteria)
  })

  it('assigns a UUID id', () => {
    const badge = createBadgeDefinition(validInput, clock)
    expect(badge.id).toBeTruthy()
    expect(typeof badge.id).toBe('string')
  })

  it('defaults criteriaVersion to 1 when not provided', () => {
    const badge = createBadgeDefinition(validInput, clock)
    expect(badge.criteriaVersion).toBe(1)
  })

  it('uses provided criteriaVersion when given', () => {
    const badge = createBadgeDefinition({ ...validInput, criteriaVersion: 3 }, clock)
    expect(badge.criteriaVersion).toBe(3)
  })

  it('defaults enabled to true when not provided', () => {
    const badge = createBadgeDefinition(validInput, clock)
    expect(badge.enabled).toBe(true)
  })

  it('uses provided enabled when given', () => {
    const badge = createBadgeDefinition({ ...validInput, enabled: false }, clock)
    expect(badge.enabled).toBe(false)
  })

  it('uses clock() for createdAt and updatedAt', () => {
    const badge = createBadgeDefinition(validInput, clock)
    expect(badge.createdAt).toEqual(fixedDate)
    expect(badge.updatedAt).toEqual(fixedDate)
  })

  it('supports portal_group targetScope', () => {
    const badge = createBadgeDefinition(
      { ...validInput, targetScope: 'portal_group' },
      clock,
    )
    expect(badge.targetScope).toBe('portal_group')
  })
})

describe('normalizeBadgeCriteria', () => {
  it('defaults aggregation to sum when not provided', () => {
    const { aggregation: _a, ...withoutAgg } = validCriteria
    const result = normalizeBadgeCriteria(withoutAgg)
    expect(result.aggregation).toBe('sum')
  })

  it('defaults period to all_time when not provided', () => {
    const { period: _p, ...withoutPeriod } = validCriteria
    const result = normalizeBadgeCriteria(withoutPeriod)
    expect(result.period).toBe('all_time')
  })

  it('preserves explicitly set period', () => {
    const result = normalizeBadgeCriteria({ ...validCriteria, period: 'last_30_days' })
    expect(result.period).toBe('last_30_days')
  })

  it('preserves required fields (type, metricKey, operator, threshold)', () => {
    const result = normalizeBadgeCriteria(validCriteria)
    expect(result.type).toBe('threshold')
    expect(result.metricKey).toBe('portal.scan')
    expect(result.operator).toBe('>=')
    expect(result.threshold).toBe(100)
  })
})
