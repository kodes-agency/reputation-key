import { describe, expect, it } from 'vitest'
import type { NotificationCategoryDefault } from '#/contexts/feed/application/public-api'
import { describeInheritedDefault } from './notification-inherited-defaults'

const stored = (): NotificationCategoryDefault =>
  ({
    category: 'workflow_collaboration',
    channel: 'email',
    enabled: true,
    cadence: 'daily',
  }) as NotificationCategoryDefault

describe('describeInheritedDefault', () => {
  it('names what a property with no settings of its own gets', () => {
    expect(describeInheritedDefault('workflow_collaboration', [])).toBe(
      'A new property gets in-app on, email off.',
    )
  })

  it("follows the person's saved default once they have one", () => {
    expect(
      describeInheritedDefault('workflow_collaboration', [
        { ...stored(), enabled: true, cadence: 'daily' },
      ]),
    ).toBe('A new property gets in-app on, email daily at 08:00.')
  })

  it('says immediate when that is what the person chose', () => {
    expect(
      describeInheritedDefault('urgent_operational', [
        { ...stored(), category: 'urgent_operational', cadence: 'immediate' },
      ]),
    ).toBe('A new property gets in-app on, email immediately.')
  })

  it('reads a default for the other channel without confusing the two', () => {
    expect(
      describeInheritedDefault('recognition', [
        { ...stored(), category: 'recognition', channel: 'in_app', enabled: false },
      ]),
    ).toBe('A new property gets in-app off, email off.')
  })
})
