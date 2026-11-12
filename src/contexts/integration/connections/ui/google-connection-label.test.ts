import { describe, expect, it } from 'vitest'
import { googleConnectionLabel } from './google-connection-label'

describe('Google connection label', () => {
  it('names a connection by its Google account address', () => {
    expect(
      googleConnectionLabel({
        accountEmail: 'reviews@meridian.example',
        createdAt: new Date('2026-09-15T08:00:00.000Z'),
      }),
    ).toBe('reviews@meridian.example')
  })

  it('tells an older connection apart by the UTC day it was connected', () => {
    expect(
      googleConnectionLabel({
        accountEmail: null,
        createdAt: new Date('2026-09-14T23:30:00.000Z'),
      }),
    ).toBe('Google account connected Sep 14, 2026')
  })
})
