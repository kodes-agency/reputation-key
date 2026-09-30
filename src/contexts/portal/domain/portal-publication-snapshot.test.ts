import { describe, expect, it } from 'vitest'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  guestSurfaceOfConfiguration,
} from './portal-publication-snapshot'

describe('guest surface of a publication configuration', () => {
  it('keeps the legacy surface for schema versions 1 and 2', () => {
    expect(guestSurfaceOfConfiguration({ schemaVersion: 1 })).toBe('legacy')
    expect(guestSurfaceOfConfiguration({ schemaVersion: 2 })).toBe('legacy')
  })

  it('is the Immersive Hub from schema version 3 on', () => {
    expect(IMMERSIVE_HUB_SCHEMA_VERSION).toBe(3)
    expect(guestSurfaceOfConfiguration({ schemaVersion: 3 })).toBe('immersive')
    expect(guestSurfaceOfConfiguration({ schemaVersion: 4 })).toBe('immersive')
  })
})
