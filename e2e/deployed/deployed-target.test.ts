import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertApprovedSyntheticOrganization,
  deployedTarget,
  deployedUrl,
  DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT,
  DEPLOYED_PRODUCTION_ORIGIN,
} from './deployed-target'

const APPROVED_ORGANIZATION = '11111111-1111-4111-8111-111111111111'

const VALID_ENV = {
  DEPLOYED_BASE_URL: DEPLOYED_PRODUCTION_ORIGIN,
  DEPLOYED_SYNTHETIC_ORGANIZATION_ID: APPROVED_ORGANIZATION,
} as const

describe('deployed target guard', () => {
  it('throws when DEPLOYED_BASE_URL is absent rather than defaulting an origin', () => {
    expect(() =>
      deployedTarget({ DEPLOYED_SYNTHETIC_ORGANIZATION_ID: APPROVED_ORGANIZATION }),
    ).toThrow(/DEPLOYED_BASE_URL is not set/u)
  })

  it('throws for any origin that is not exactly the production cell-us origin', () => {
    for (const baseUrl of [
      'http://localhost:3000',
      'https://staging.reputationkey.app',
      'https://eu.reputationkey.app',
      'https://us.reputationkey.app/',
      'https://us.reputationkey.app.evil.example',
      'http://us.reputationkey.app',
    ]) {
      expect(
        () => deployedTarget({ ...VALID_ENV, DEPLOYED_BASE_URL: baseUrl }),
        baseUrl,
      ).toThrow(/not the production cell-us origin/u)
    }
  })

  it('throws when the synthetic Organization id is absent or malformed', () => {
    for (const id of [undefined, '', 'not-a-uuid', '11111111-1111-4111-8111']) {
      expect(() =>
        deployedTarget({
          DEPLOYED_BASE_URL: DEPLOYED_PRODUCTION_ORIGIN,
          ...(id === undefined ? {} : { DEPLOYED_SYNTHETIC_ORGANIZATION_ID: id }),
        }),
      ).toThrow(/approved synthetic Organization id/u)
    }
  })

  it('refuses an Organization that is not the approved synthetic one', () => {
    const target = deployedTarget(VALID_ENV)
    expect(assertApprovedSyntheticOrganization(APPROVED_ORGANIZATION, target)).toBe(
      APPROVED_ORGANIZATION,
    )
    expect(() =>
      assertApprovedSyntheticOrganization('22222222-2222-4222-8222-222222222222', target),
    ).toThrow(/may not touch a real tenant/u)
  })

  it('builds absolute production URLs only', () => {
    const target = deployedTarget(VALID_ENV)
    expect(deployedUrl(target, '/api/health/ready')).toBe(
      `${DEPLOYED_PRODUCTION_ORIGIN}/api/health/ready`,
    )
    expect(() => deployedUrl(target, 'api/health/ready')).toThrow(/must be absolute/u)
  })
})

describe('deployed probe isolation', () => {
  const deployedDir = resolve('e2e/deployed')
  const files = readdirSync(deployedDir).filter((name) => name.endsWith('.ts'))

  it('contains the read-only probe spec the Gate F evidence schema names', () => {
    expect(files).toContain('closed-beta-deployed-probes.spec.ts')
  })

  it('cannot reach any mutating seed or fixture helper', () => {
    // The local suite seeds and truncates a database. If any file here could
    // import those helpers — directly or through a sibling — a mis-set
    // DEPLOYED_BASE_URL would stop being the only thing standing between a
    // test run and production data.
    const allowedSpecifiers = /^(@playwright\/test|vitest|node:[a-z_/]+|\.\/[a-z-]+)$/u
    for (const file of files) {
      const source = readFileSync(resolve(deployedDir, file), 'utf8')
      const specifiers = [...source.matchAll(/(?:from|import)\s+'([^']+)'/gu)].map(
        (match) => match[1] ?? '',
      )
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(allowedSpecifiers)
        expect(specifier).not.toContain('fixtures')
        expect(specifier).not.toContain('helpers')
        expect(specifier).not.toContain('seed')
      }
    }
  })

  it('declares an isolated no-retry Playwright project with no local setup dependency', () => {
    expect(DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT.name).toBe('deployed-critical')
    expect(DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT.retries).toBe(0)
    expect(DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT.workers).toBe(1)
    expect(DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT).not.toHaveProperty('dependencies')
    expect(
      DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT.testMatch.test(
        'e2e/deployed/closed-beta-deployed-probes.spec.ts',
      ),
    ).toBe(true)
  })
})
