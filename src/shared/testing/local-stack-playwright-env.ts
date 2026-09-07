import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const REQUIRED_STACK_ENV_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_HOST_PORT',
  'POSTGRES_DB',
  'REDIS_HOST_PORT',
  'QUEUE_REDIS_HOST_PORT',
  'OPS_METRICS_TOKEN',
  'E2E_TEST_EMAIL',
  'E2E_TEST_PASSWORD',
] as const

export function parseLocalStackEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        if (separator <= 0)
          throw new Error(`Invalid local stack environment line: ${line}`)
        const encoded = line
          .slice(separator + 1)
          .replace(/\s+#\s*gitleaks:allow\s*$/u, '')
        return [line.slice(0, separator), JSON.parse(encoded) as string]
      }),
  )
}

export function localStackPlaywrightEnv(path: string): Record<string, string> {
  const stack = parseLocalStackEnvFile(path)
  for (const key of REQUIRED_STACK_ENV_KEYS) {
    if (!stack[key]) throw new Error(`Local stack environment is missing ${key}`)
  }

  return {
    ...stack,
    TEST_DATABASE_URL: `postgresql://${encodeURIComponent(stack.POSTGRES_USER!)}:${encodeURIComponent(stack.POSTGRES_PASSWORD!)}@127.0.0.1:${stack.POSTGRES_HOST_PORT}/${encodeURIComponent(stack.POSTGRES_DB!)}`,
    REDIS_URL: `redis://127.0.0.1:${stack.REDIS_HOST_PORT}`,
    // The non-production BullMQ fallback deliberately shares the one Redis.
    QUEUE_REDIS_URL: `redis://127.0.0.1:${stack.QUEUE_REDIS_HOST_PORT}`,
    CI: '1',
    E2E_EXTERNAL_STACK: '1',
    E2E_BASE_URL: 'http://127.0.0.1:3000',
    E2E_LOCKED_BASE_URL: 'http://127.0.0.1:3001',
    // The sandbox is TLS-only (ADR 0050); scripts/e2e/gen-certs.sh writes the
    // CA next to the env file and every Playwright worker trusts it at start.
    GBP_STUB_BASE_URL: 'https://127.0.0.1:4100',
    NODE_EXTRA_CA_CERTS: resolve(dirname(path), '.certs/ca.crt'),
    MAIL_STUB_BASE_URL: 'http://127.0.0.1:4101',
    OPS_METRICS_TOKEN: stack.OPS_METRICS_TOKEN!,
    E2E_TEST_EMAIL: stack.E2E_TEST_EMAIL!,
    E2E_TEST_PASSWORD: stack.E2E_TEST_PASSWORD!,
  }
}
