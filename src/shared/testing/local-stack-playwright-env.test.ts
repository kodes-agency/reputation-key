import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localStackPlaywrightEnv,
  parseLocalStackEnvFile,
} from './local-stack-playwright-env'
import { createProductJourneyBrowserEnvironment } from '../../../scripts/beta/run-product-journeys'

describe('local stack Playwright environment', () => {
  it('binds browser tests to the generated stack resources and canonical origins', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'repkey-stack-env-'))
    const path = resolve(directory, 'stack.env')
    writeFileSync(
      path,
      [
        'POSTGRES_USER="local user"',
        'POSTGRES_PASSWORD="p@ss/word"',
        'POSTGRES_HOST_PORT="55432"',
        'POSTGRES_DB="repkey-e2e"',
        'REDIS_HOST_PORT="56379"',
        'OPS_METRICS_TOKEN="metrics-secret"',
        'ENCRYPTION_KEY="stack-encryption-key"',
        'E2E_TEST_EMAIL="admin@example.com"',
        'E2E_TEST_PASSWORD="password-secret"',
        '',
      ].join('\n'),
    )

    expect(parseLocalStackEnvFile(path)).toMatchObject({
      POSTGRES_USER: 'local user',
      POSTGRES_PASSWORD: 'p@ss/word',
    })
    expect(localStackPlaywrightEnv(path)).toEqual({
      POSTGRES_USER: 'local user',
      POSTGRES_PASSWORD: 'p@ss/word',
      POSTGRES_HOST_PORT: '55432',
      POSTGRES_DB: 'repkey-e2e',
      REDIS_HOST_PORT: '56379',
      ENCRYPTION_KEY: 'stack-encryption-key',
      TEST_DATABASE_URL:
        'postgresql://local%20user:p%40ss%2Fword@127.0.0.1:55432/repkey-e2e',
      REDIS_URL: 'redis://127.0.0.1:56379',
      CI: '1',
      E2E_EXTERNAL_STACK: '1',
      E2E_BASE_URL: 'http://127.0.0.1:3000',
      E2E_LOCKED_BASE_URL: 'http://127.0.0.1:3001',
      GBP_STUB_BASE_URL: 'http://127.0.0.1:4100',
      MAIL_STUB_BASE_URL: 'http://127.0.0.1:4101',
      OPS_METRICS_TOKEN: 'metrics-secret',
      E2E_TEST_EMAIL: 'admin@example.com',
      E2E_TEST_PASSWORD: 'password-secret',
    })
  })

  it('injects the beta stack origin into promoted product journeys', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'repkey-beta-journey-env-'))
    const path = resolve(directory, 'stack.env')
    writeFileSync(
      path,
      [
        'POSTGRES_USER="beta"',
        'POSTGRES_PASSWORD="password"',
        'POSTGRES_HOST_PORT="55432"',
        'POSTGRES_DB="repkey-beta"',
        'REDIS_HOST_PORT="56379"',
        'OPS_METRICS_TOKEN="metrics-secret"',
        'E2E_TEST_EMAIL="manager@example.com"',
        'E2E_TEST_PASSWORD="password-secret"',
        '',
      ].join('\n'),
    )

    expect(
      createProductJourneyBrowserEnvironment(path, {
        E2E_BASE_URL: 'http://localhost:3000',
        UNRELATED_PARENT_VALUE: 'preserved',
      }),
    ).toMatchObject({
      E2E_BASE_URL: 'http://127.0.0.1:3000',
      E2E_EXTERNAL_STACK: '1',
      E2E_TEST_EMAIL: 'manager@example.com',
      UNRELATED_PARENT_VALUE: 'preserved',
    })
  })
})
