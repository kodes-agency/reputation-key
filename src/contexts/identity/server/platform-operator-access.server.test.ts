import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('#/shared/auth/middleware', () => ({
  getSessionFromHeaders: mocks.getSession,
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
  user: Readonly<{ id?: string; email?: string; name?: string }> = {},
  signedInMsAgo = 60_000,
) {
  const id = user.id ?? 'user-operator'
  return {
    session: {
      id: 'session-1',
      userId: id,
      createdAt: new Date(NOW.getTime() - signedInMsAgo),
    },
    user: {
      id,
      name: user.name ?? 'Owner Name',
      email: user.email ?? 'owner@example.com',
      emailVerified: true,
    },
  }
}

const logger = {
  info: vi.fn(),
  warn: mocks.warn,
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}

const read = (mutation = false) =>
  requirePlatformOperator(HEADERS, { mutation, now: NOW, logger })

describe('operatorPrincipalId', () => {
  it('names the account, never the address: user:<user id>', () => {
    expect(operatorPrincipalId({ id: 'user-operator' })).toBe('user:user-operator')
  })
})

describe('requirePlatformOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installPolicy('user:user-operator,owner@example.com,ops-cli-name')
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

  it('refuses a user whose account the allowlist does not name', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ id: 'user-manager-one', email: 'manager-one@example.com' }),
    )

    await expect(read()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('refuses a verified email the allowlist names, when its account is not listed', async () => {
    // An AccountAdmin can invite a listed address that has no account yet and
    // register it through the invitation, which verifies it (ADR 0062): the
    // address proves nothing about who holds the account.
    mocks.getSession.mockResolvedValue(
      sessionFor({ id: 'user-claimed-by-inviter', email: 'owner@example.com' }),
    )

    await expect(read()).rejects.toMatchObject({
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('refuses everyone when no allowlist is configured', async () => {
    resetExecutionPolicy()
    installPolicy(undefined)
    mocks.getSession.mockResolvedValue(sessionFor())

    await expect(read()).rejects.toMatchObject({
      code: 'operator_not_registered',
      status: 403,
    })
  })

  it('logs a refusal content-free: the reason, no user id or email', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ id: 'user-manager-one', email: 'manager-one@example.com' }),
    )

    await expect(read()).rejects.toMatchObject({ status: 403 })

    expect(mocks.warn).toHaveBeenCalledWith(
      { event: 'platform.operator_denied', reason: 'operator_not_registered' },
      expect.any(String),
    )
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/manager-one/)
  })

  it('admits the listed account, whatever its address', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({ email: 'renamed@example.com', name: 'Bo' }),
    )

    await expect(read()).resolves.toEqual({ userId: 'user-operator', name: 'Bo' })
  })

  it('lets a read through on a session signed in long ago', async () => {
    mocks.getSession.mockResolvedValue(sessionFor({}, 5 * 60 * 60_000))

    await expect(read(false)).resolves.toMatchObject({ userId: 'user-operator' })
  })

  it('asks for a fresh sign-in before a change on an older session', async () => {
    expect(OPERATOR_MUTATION_SESSION_MAX_AGE_MS).toBe(30 * 60 * 1000)
    mocks.getSession.mockResolvedValue(
      sessionFor({}, OPERATOR_MUTATION_SESSION_MAX_AGE_MS + 1),
    )

    await expect(read(true)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'operator_reauth_required',
      status: 403,
    })
  })

  it('allows a change on a session signed in within 30 minutes', async () => {
    mocks.getSession.mockResolvedValue(
      sessionFor({}, OPERATOR_MUTATION_SESSION_MAX_AGE_MS),
    )

    await expect(read(true)).resolves.toMatchObject({ userId: 'user-operator' })
  })
})
