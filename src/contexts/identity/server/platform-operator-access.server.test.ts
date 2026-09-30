import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('#/shared/auth/middleware', () => ({
  getSessionFromHeaders: mocks.getSession,
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: mocks.warn,
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }),
}))

import {
  createExecutionPolicy,
  initExecutionPolicy,
  parseOperatorIdentities,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  OPERATOR_MUTATION_SESSION_MAX_AGE_MS,
  operatorPrincipalId,
  requirePlatformOperator,
} from './platform-operator-access.server'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const HEADERS = new Headers({ cookie: 'session=current' })

function installPolicy(allowlist: string | undefined): void {
  const operators = parseOperatorIdentities({ OPS_OPERATOR_IDENTITIES: allowlist })
  initExecutionPolicy(
    createExecutionPolicy({
      listAccessiblePropertyIds: async () => [],
      ...(allowlist === undefined
        ? {}
        : { isRegisteredOperator: (id: string) => operators.has(id) }),
    }),
  )
}

function sessionFor(
  user: Readonly<{ email: string; emailVerified: boolean; name?: string }>,
  signedInMsAgo = 60_000,
) {
  return {
    session: {
      id: 'session-1',
      userId: 'user-operator',
      createdAt: new Date(NOW.getTime() - signedInMsAgo),
    },
    user: {
      id: 'user-operator',
      name: user.name ?? 'Owner Name',
      email: user.email,
      emailVerified: user.emailVerified,
    },
  }
}

const read = (mutation = false) =>
  requirePlatformOperator(HEADERS, { mutation, now: NOW })

describe('operatorPrincipalId', () => {
  it('is the trimmed, lowercased email of a verified user', () => {
    expect(
      operatorPrincipalId({ email: ' Owner@Example.COM ', emailVerified: true }),
    ).toBe('owner@example.com')
  })

  it('is null for an unverified email', () => {
    expect(
      operatorPrincipalId({ email: 'owner@example.com', emailVerified: false }),
    ).toBe(null)
  })
})

describe('requirePlatformOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installPolicy('owner@example.com,ops-cli-name')
  })
  afterEach(() => resetExecutionPolicy())

  it('refuses a request without a session as unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(read()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'unauthorized',
      status: 401,
    })
  })

  it('refuses an unverified email even when the allowlist names it', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'owner@example.com', emailVerified: false }),
    )

    await expect(read()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('refuses a verified email the allowlist does not name', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'manager-one@example.com', emailVerified: true }),
    )

    await expect(read()).rejects.toMatchObject({
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('refuses everyone when no allowlist is configured', async () => {
    resetExecutionPolicy()
    installPolicy(undefined)
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'owner@example.com', emailVerified: true }),
    )

    await expect(read()).rejects.toMatchObject({
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('logs a refusal by user id only, never by email', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'manager-one@example.com', emailVerified: true }),
    )

    await expect(read()).rejects.toMatchObject({ status: 403 })

    expect(mocks.warn).toHaveBeenCalledWith(
      {
        event: 'platform.operator_denied',
        userId: 'user-operator',
        reason: 'operator_not_registered',
      },
      expect.any(String),
    )
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('manager-one')
  })

  it('matches a mixed-case session email against a lowercase entry', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'Owner@Example.com', emailVerified: true, name: 'Bo' }),
    )

    await expect(read()).resolves.toEqual({
      userId: 'user-operator',
      email: 'owner@example.com',
      name: 'Bo',
    })
  })

  it('lets a read through on a session signed in long ago', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'owner@example.com', emailVerified: true }, 5 * 60 * 60_000),
    )

    await expect(read(false)).resolves.toMatchObject({ userId: 'user-operator' })
  })

  it('asks for a fresh sign-in before a change on an older session', async () => {
    expect(OPERATOR_MUTATION_SESSION_MAX_AGE_MS).toBe(30 * 60 * 1000)
    mocks.getSession.mockResolvedValue(
      sessionFor(
        { email: 'owner@example.com', emailVerified: true },
        OPERATOR_MUTATION_SESSION_MAX_AGE_MS + 1,
      ),
    )

    await expect(read(true)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'operator_reauth_required',
      status: 403,
    })
  })

  it('allows a change on a session signed in within 30 minutes', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor(
        { email: 'owner@example.com', emailVerified: true },
        OPERATOR_MUTATION_SESSION_MAX_AGE_MS,
      ),
    )

    await expect(read(true)).resolves.toMatchObject({ email: 'owner@example.com' })
  })
})
