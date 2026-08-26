import { describe, expect, it } from 'vitest'
import { testEnvironment } from '#/shared/testing/test-environment'
import { parseEnvironment } from './env'

const productionEnvironment = {
  ...testEnvironment({}),
  NODE_ENV: 'production' as const,
  BETTER_AUTH_URL: 'https://app.reputationkey.app',
}

describe('environment parsing', () => {
  it('refuses production startup without an explicit processing cell', () => {
    expect(() => parseEnvironment(productionEnvironment)).toThrow(
      'Production deployments require an explicit PROCESSING_CELL',
    )
  })

  it('retains the deliberate US default for local and test environments', () => {
    expect(parseEnvironment(testEnvironment({})).PROCESSING_CELL).toBe('us')
  })

  it('accepts an explicit known processing cell in production', () => {
    expect(
      parseEnvironment({ ...productionEnvironment, PROCESSING_CELL: 'europe' })
        .PROCESSING_CELL,
    ).toBe('europe')
  })
})
