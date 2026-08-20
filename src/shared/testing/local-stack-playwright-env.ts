import { readFileSync } from 'node:fs'

const REQUIRED_STACK_ENV_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_HOST_PORT',
  'POSTGRES_DB',
  'REDIS_HOST_PORT',
  'OPS_METRICS_TOKEN',
  'E2E_TEST_EMAIL',
  'E2E_TEST_PASSWORD',
] as const

export function parseLocalStackEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        if (separator <= 0)
          throw new Error(`Invalid local stack environment line: ${line}`)
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1)) as string]
      }),
  )
}

export function localStackPlaywrightEnv(path: string): Record<string, string> {
  const generated = parseLocalStackEnvFile(path)
  for (const key of REQUIRED_STACK_ENV_KEYS) {
    if (!generated[key])
      throw new Error(`Generated local stack environment is missing ${key}`)
  }

  return {
    ...generated,
    TEST_DATABASE_URL: `postgresql://${encodeURIComponent(generated.POSTGRES_USER!)}:${encodeURIComponent(generated.POSTGRES_PASSWORD!)}@127.0.0.1:${generated.POSTGRES_HOST_PORT}/${encodeURIComponent(generated.POSTGRES_DB!)}`,
    REDIS_URL: `redis://127.0.0.1:${generated.REDIS_HOST_PORT}`,
    CI: '1',
    E2E_EXTERNAL_STACK: '1',
    E2E_BASE_URL: 'http://127.0.0.1:3000',
    E2E_LOCKED_BASE_URL: 'http://127.0.0.1:3001',
    GBP_STUB_BASE_URL: 'http://127.0.0.1:4100',
    MAIL_STUB_BASE_URL: 'http://127.0.0.1:4101',
    OPS_METRICS_TOKEN: generated.OPS_METRICS_TOKEN!,
    E2E_TEST_EMAIL: generated.E2E_TEST_EMAIL!,
    E2E_TEST_PASSWORD: generated.E2E_TEST_PASSWORD!,
  }
}
