import { describe, expect, it } from 'vitest'
import * as finalSchema from './index'
import * as compatibilitySchema from './google-import-compatibility.schema'

const COMPATIBILITY_EXPORTS = [
  'legacyGbpCache',
  'legacyGbpImportJobs',
  'gbpImportLegacyHistory',
  'legacyImportControl',
  'legacyImportEffectLeases',
] as const

describe('Google import schema artifact boundary', () => {
  it('keeps compatibility tables out of the final application schema barrel', () => {
    for (const name of COMPATIBILITY_EXPORTS) {
      expect(finalSchema).not.toHaveProperty(name)
    }
  })

  it('retains the frozen tables for compatibility tooling until contract cutover', () => {
    for (const name of COMPATIBILITY_EXPORTS) {
      expect(compatibilitySchema).toHaveProperty(name)
    }
  })
})
