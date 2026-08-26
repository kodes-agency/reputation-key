import { describe, expect, it } from 'vitest'
import { COMPATIBILITY_PROJECTS } from './compatibility-projects'

describe('Playwright compatibility project authority', () => {
  it('pins one explicit project for every required browser and mobile family', () => {
    expect(COMPATIBILITY_PROJECTS.map(({ name }) => name)).toEqual([
      'compat-firefox',
      'compat-webkit',
      'compat-mobile-android',
      'compat-mobile-ios',
    ])

    expect(
      COMPATIBILITY_PROJECTS.map(({ use }) => ({
        browserName: use.browserName,
        isMobile: use.isMobile ?? false,
      })),
    ).toEqual([
      { browserName: 'firefox', isMobile: false },
      { browserName: 'webkit', isMobile: false },
      { browserName: 'chromium', isMobile: true },
      { browserName: 'webkit', isMobile: true },
    ])
  })

  it('keeps compatibility work read-only, bounded, and setup-gated', () => {
    for (const project of COMPATIBILITY_PROJECTS) {
      expect(project.dependencies).toEqual(['setup'])
      expect(project.testMatch).toEqual(/compatibility\/.*\.spec\.ts/)
      expect(project.workers).toBe(1)
    }
  })
})
