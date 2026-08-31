import { devices, type PlaywrightTestConfig } from '@playwright/test'

const compatibilitySpec = /compatibility\/.*\.spec\.ts/

/**
 * The bounded compatibility matrix. These projects deliberately run only the
 * read-only compatibility journeys; the Chromium critical/full projects remain
 * the exhaustive product gates.
 */
export const COMPATIBILITY_PROJECTS = [
  {
    name: 'compat-firefox',
    testMatch: compatibilitySpec,
    dependencies: ['setup'],
    workers: 1,
    use: { ...devices['Desktop Firefox'], browserName: 'firefox' },
  },
  {
    name: 'compat-webkit',
    testMatch: compatibilitySpec,
    dependencies: ['setup'],
    workers: 1,
    use: { ...devices['Desktop Safari'], browserName: 'webkit' },
  },
  {
    name: 'compat-mobile-android',
    testMatch: compatibilitySpec,
    dependencies: ['setup'],
    workers: 1,
    use: { ...devices['Pixel 7'], browserName: 'chromium' },
  },
  {
    name: 'compat-mobile-ios',
    testMatch: compatibilitySpec,
    dependencies: ['setup'],
    workers: 1,
    use: { ...devices['iPhone 15'], browserName: 'webkit' },
  },
] as const satisfies NonNullable<PlaywrightTestConfig['projects']>
