import { describe, expect, it } from 'vitest'
import { notificationPreferenceCategory } from './notifications'

describe('notification preference API contract', () => {
  it('refuses Organization mandatory policy on Property preference endpoints', () => {
    expect(notificationPreferenceCategory.safeParse('mandatory').success).toBe(false)
  })

  it.each(['urgent_operational', 'workflow_collaboration', 'recognition'] as const)(
    'accepts configurable Property category %s',
    (category) => {
      expect(notificationPreferenceCategory.safeParse(category).success).toBe(true)
    },
  )
})
