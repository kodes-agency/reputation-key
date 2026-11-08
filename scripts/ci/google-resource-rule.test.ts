import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Exercise the detector bytes used by gitleaks without introducing resource
// literals into fixtures outside the generated catalogue.
const source = readFileSync('.gitleaks.toml', 'utf8').split(
  'id = "google-resource-name"',
)[1]
const expression = source?.match(/regex = '''([^]*?)'''/u)?.[1]
if (!expression) throw new Error('Google resource-name detector is missing')
const detector = () => new RegExp(expression, 'gu')
const account = ['accounts', '123456789012345678'].join('/')
const location = [account, 'locations', '234567890123456789'].join('/')
const review = [location, 'reviews', 'review_opaque-id'].join('/')

const allowlist = source?.split('[[rules.allowlists]]')[1]
const paths = [
  ...(allowlist?.match(/paths = \[([^]*?)\]/u)?.[1] ?? '').matchAll(/'''([^]*?)'''/gu),
].map((match) => new RegExp(match[1] ?? '', 'u'))
const allowedResource = allowlist?.match(/regexes = \['''([^]*?)'''\]/u)?.[1]
if (!allowedResource) throw new Error('Synthetic resource exception is missing')
function isExcepted(path: string, resource: string) {
  return (
    paths.some((pattern) => pattern.test(path)) &&
    new RegExp(allowedResource ?? '', 'u').test(resource)
  )
}

describe('Google resource-name secret detector', () => {
  it.each([account, location, review])(
    'detects a resource literal without printing it',
    (resource) => {
      expect(
        [...`const resource = '${resource}'`.matchAll(detector())].map(
          (match) => match[1],
        ),
      ).toEqual([resource])
    },
  )

  it.each([
    '/accounts/staff',
    '/accounts/portals',
    'src/contexts/accounts/server/example',
    'accounts/{accountId}',
    'locations/{locationId}',
  ])('keeps application paths and documented templates: %s', (value) => {
    expect([...`const path = '${value}'`.matchAll(detector())]).toEqual([])
  })

  it('detects a literal at the start of a file or after a line break', () => {
    expect([...`${account}\n`.matchAll(detector())]).toHaveLength(1)
    expect([...`example\n${review}\n`.matchAll(detector())]).toHaveLength(1)
  })
  it('exempts a generated synthetic resource only in its named files', () => {
    const synthetic = ['accounts', 'repkey-synthetic-do-not-use-account-0001'].join('/')
    const generated = 'test-fixtures/generated/google-provider-identifiers-v1.ts'
    expect(isExcepted(generated, synthetic)).toBe(true)
    expect(isExcepted(generated, account)).toBe(false)
    expect(isExcepted('src/example.test.ts', synthetic)).toBe(false)
    expect(isExcepted('test-fixtures/generated/new-fixture.ts', synthetic)).toBe(false)
  })
})
