import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const featureDirectory = resolve(
  root,
  'src/components/features/integration/google-import-manager',
)
const applicationDirectory = resolve(root, 'src/contexts/integration/application')

describe('Google import provider-content lifecycle ownership', () => {
  it('keeps lifecycle policy behind the Integration application public API', () => {
    const legacyFeaturePolicy = resolve(
      featureDirectory,
      'google-import-content-lifecycle.ts',
    )
    const applicationPolicy = resolve(
      applicationDirectory,
      'google-import-content-lifecycle.ts',
    )
    const applicationPolicySource = readFileSync(applicationPolicy, 'utf8')
    const publicApi = readFileSync(resolve(applicationDirectory, 'public-api.ts'), 'utf8')
    const hook = readFileSync(
      resolve(featureDirectory, 'use-google-import-content.ts'),
      'utf8',
    )

    expect(existsSync(legacyFeaturePolicy)).toBe(false)
    expect(existsSync(applicationPolicy)).toBe(true)
    expect(publicApi).toContain("from './google-import-content-lifecycle'")
    expect(hook).toContain("from '#/contexts/integration/application/public-api'")
    expect(applicationPolicySource).not.toMatch(
      /(?:from ['"]react['"]|@tanstack|\bdocument\b|\bwindow\b)/u,
    )
    expect(hook).toMatch(/(?:useEffect|useQueryClient|\bdocument\b|\bwindow\b)/u)
  })
})
