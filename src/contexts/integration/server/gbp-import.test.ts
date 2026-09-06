import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import { GoogleImportTransactionError } from '../application/google-import-transaction'

/** The standard-schema surface consumed by TanStack Start's server-function builder. */
type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>()
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})
vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationPublicApi: {
      imports: {
        transact: {
          start: mocks.start,
        },
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionPolicyModule>()
  return { ...actual, requireExecutionAllowed: mocks.requireExecutionAllowed }
})

import { startPropertyImportV2 } from './gbp-import'

const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const IMPORT_JOB_ID = '00000000-0000-4000-8000-000000000002'
const CANDIDATE_REF = `v1.${'A'.repeat(43)}`
const ACTOR = {
  organizationId: '00000000-0000-4000-8000-000000000003',
  userId: 'user-1',
  role: 'AccountAdmin',
}
const INPUT = {
  requestId: REQUEST_ID,
  confirmation: 'apply' as const,
  items: [
    {
      candidateRef: CANDIDATE_REF,
      action: 'create' as const,
      profile: {
        name: 'Cafe North',
        address: null,
        countryCode: 'US',
        timezone: 'America/New_York',
        confirmed: true as const,
      },
    },
  ],
}

const callStart = () => startPropertyImportV2({ data: INPUT })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.start.mockResolvedValue({ importJobId: IMPORT_JOB_ID, replayed: false })
})

describe('startPropertyImportV2', () => {
  it('starts a durable import', async () => {
    await expect(callStart()).resolves.toEqual({
      importJobId: IMPORT_JOB_ID,
      replayed: false,
      requestId: REQUEST_ID,
    })
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })

  it('surfaces a durable contract rejection as a non-availability failure', async () => {
    mocks.start.mockRejectedValueOnce(
      new GoogleImportTransactionError('contract_rejected'),
    )

    await expect(callStart()).rejects.toMatchObject({
      name: 'GoogleImportTransactionError',
      code: 'contract_rejected',
      status: 500,
    })
  })
})
