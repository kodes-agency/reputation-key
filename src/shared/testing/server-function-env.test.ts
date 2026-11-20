import { afterEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { applyEnvOverlay } from './server-function-env'

const KEY = 'BETA_SUSPENDED_ORGS'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('applyEnvOverlay', () => {
  it('sets, re-reads and restores a variable that was unset', () => {
    delete process.env[KEY]
    const restore = applyEnvOverlay({ [KEY]: 'org-a,org-b' })

    expect(getEnv().BETA_SUSPENDED_ORGS).toBe('org-a,org-b')
    restore()

    expect(process.env[KEY]).toBeUndefined()
    expect(getEnv().BETA_SUSPENDED_ORGS).toBeUndefined()
  })

  it('removes a variable for the overlay and puts its value back', () => {
    process.env[KEY] = 'org-kept'
    const restore = applyEnvOverlay({ [KEY]: undefined })

    expect(getEnv().BETA_SUSPENDED_ORGS).toBeUndefined()
    restore()

    expect(getEnv().BETA_SUSPENDED_ORGS).toBe('org-kept')
  })
})
