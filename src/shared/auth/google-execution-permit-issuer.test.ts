import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleExecutionPermitIssuer,
  type GoogleExecutionPermitAdmissionInput,
  type GoogleExecutionPermitRecord,
} from './google-execution-permit-issuer'

const NOW = new Date('2026-08-10T10:00:00.000Z')
type Tx = Readonly<Record<string, never>>

const admissionInput = (
  overrides: Partial<GoogleExecutionPermitAdmissionInput> = {},
): GoogleExecutionPermitAdmissionInput => ({
  capability: 'property.import_gbp_v2',
  scope: {
    organizationId: 'org-1',
    propertyId: null,
    connectionId: 'connection-1',
    initiatorUserId: 'user-1',
  },
  expectedAuthorizationVector: { grantGeneration: 3, connectionGeneration: 8 },
  operationKey: 'import.start',
  routeKey: 'google.business-information.locations.list',
  routeCatalogVersion: 'google-provider-routes-1',
  quotaPolicyId: 'gbp-business-information-interactive-1',
  providerRequestBinding: {
    requestBindingSha256: 'a'.repeat(64),
    credentialBinding: 'b'.repeat(64),
    projectFingerprint: 'c'.repeat(64),
    requestBodySha256: null,
    requestBodyBytes: 0,
  },
  ...overrides,
})

type Step = 'begin' | 'loadControl' | 'authorize' | 'insertPermit' | 'commit'

function fixture(
  options: Readonly<{
    killed?: boolean
    vector?: Readonly<Record<string, string | number | boolean | null>>
    /** Which of the two optional timing deps the issuer is given. */
    instrument?: 'both' | 'logger-only' | 'clock-only'
    /** Fake monotonic time each step spends, advanced inside the fake store. */
    delaysMs?: Readonly<Partial<Record<Step, number>>>
    /** The step that throws `failure` after spending its delay. */
    failAt?: Step
    failure?: unknown
  }> = {},
) {
  const records: GoogleExecutionPermitRecord[] = []
  let elapsedMs = 0
  const spend = (step: Step): void => {
    elapsedMs += options.delaysMs?.[step] ?? 0
    if (options.failAt === step) throw options.failure ?? new Error('store failed')
  }
  const authorize = vi.fn(async () => {
    spend('authorize')
    return {
      allowed: true as const,
      vector: options.vector ?? { grantGeneration: 3, connectionGeneration: 8 },
    }
  })
  const nowMs = vi.fn(() => elapsedMs)
  const warn =
    vi.fn<(fields: Readonly<Record<string, unknown>>, message: string) => void>()
  const instrument = options.instrument
  const issuer = createGoogleExecutionPermitIssuer<Tx>({
    store: {
      transaction: async (run) => {
        spend('begin')
        const result = await run({})
        spend('commit')
        return result
      },
      loadControl: async () => {
        spend('loadControl')
        return { killedCapabilities: options.killed ? ['property.import_gbp_v2'] : [] }
      },
      insertPermit: async (_tx, record) => {
        spend('insertPermit')
        records.push(record)
      },
    },
    clock: () => NOW,
    newPermitId: () => 'permit-1',
    authorize,
    ...(instrument === 'both' || instrument === 'clock-only' ? { nowMs } : {}),
    ...(instrument === 'both' || instrument === 'logger-only'
      ? { logger: { warn } }
      : {}),
  })
  return { issuer, authorize, records, nowMs, warn }
}

describe('Google execution permit issuer', () => {
  it('fails closed at the live capability control before resolving authorization', async () => {
    const { issuer, authorize, records } = fixture({ killed: true })

    await expect(issuer(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'capability_killed',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('rejects a changed authorization vector without persisting a permit', async () => {
    const { issuer, records } = fixture({ vector: { grantGeneration: 4 } })

    await expect(issuer(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(records).toEqual([])
  })

  it('keeps provider request bindings out of the authorization resolver vector', async () => {
    const { issuer, records } = fixture({
      vector: {
        grantGeneration: 3,
        connectionGeneration: 8,
        requestBindingSha256: 'd'.repeat(64),
      },
    })

    await expect(
      issuer(
        admissionInput({
          expectedAuthorizationVector: {
            grantGeneration: 3,
            connectionGeneration: 8,
            requestBindingSha256: 'd'.repeat(64),
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(records).toEqual([])
  })

  it('rejects a malformed provider request binding', async () => {
    const { issuer, records } = fixture()

    await expect(
      issuer(
        admissionInput({
          providerRequestBinding: {
            ...admissionInput().providerRequestBinding,
            requestBodySha256: null,
            requestBodyBytes: 1,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(records).toEqual([])
  })

  it('persists the resolved vector and request binding in one admitted permit', async () => {
    const { issuer, records } = fixture()

    await expect(issuer(admissionInput())).resolves.toMatchObject({
      ok: true,
      permit: {
        id: 'permit-1',
        state: 'admitted',
        startDeadlineAt: new Date('2026-08-10T10:00:10.000Z'),
      },
    })
    expect(records).toEqual([
      expect.objectContaining({
        authorizationVector: {
          grantGeneration: 3,
          connectionGeneration: 8,
          requestBindingSha256: 'a'.repeat(64),
          credentialBinding: 'b'.repeat(64),
          projectFingerprint: 'c'.repeat(64),
          requestBodySha256: null,
          requestBodyBytes: 0,
        },
      }),
    ])
  })
})

const SLOW_MESSAGE = 'Google execution permit issuance was slow'
const SLOW_STAGES: Readonly<Record<Step, number>> = {
  begin: 5,
  loadControl: 20,
  authorize: 700,
  insertPermit: 300,
  commit: 40,
}

describe('Google execution permit issuance timing', () => {
  it('logs one warning with every stage when an admitted issuance is slow', async () => {
    const { issuer, warn } = fixture({ instrument: 'both', delaysMs: SLOW_STAGES })

    const result = await issuer(admissionInput())

    expect(result).toMatchObject({ ok: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-execution-permit-issuer',
        stage: 'issuance',
        capability: 'property.import_gbp_v2',
        routeKey: 'google.business-information.locations.list',
        outcome: 'admitted',
        beginMs: 5,
        loadControlMs: 20,
        authorizeMs: 700,
        insertPermitMs: 300,
        commitMs: 40,
        totalMs: 1065,
      },
      SLOW_MESSAGE,
    )
  })

  it('logs nothing for an issuance at normal latency', async () => {
    const { issuer, warn } = fixture({
      instrument: 'both',
      delaysMs: { begin: 2, loadControl: 4, authorize: 8, insertPermit: 3, commit: 2 },
    })

    await issuer(admissionInput())

    expect(warn).not.toHaveBeenCalled()
  })

  it('logs at exactly one second and stays quiet one millisecond under it', async () => {
    const atThreshold = fixture({ instrument: 'both', delaysMs: { authorize: 1000 } })
    const underThreshold = fixture({ instrument: 'both', delaysMs: { authorize: 999 } })

    await atThreshold.issuer(admissionInput())
    await underThreshold.issuer(admissionInput())

    expect(atThreshold.warn).toHaveBeenCalledTimes(1)
    expect(underThreshold.warn).not.toHaveBeenCalled()
  })

  it('logs the denial code and omits the stages a denial never reached', async () => {
    const { issuer, warn } = fixture({
      killed: true,
      instrument: 'both',
      delaysMs: { begin: 1, loadControl: 1500, commit: 2 },
    })

    const result = await issuer(admissionInput())

    expect(result).toEqual({ ok: false, code: 'capability_killed' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-execution-permit-issuer',
        stage: 'issuance',
        capability: 'property.import_gbp_v2',
        routeKey: 'google.business-information.locations.list',
        outcome: 'capability_killed',
        beginMs: 1,
        loadControlMs: 1500,
        commitMs: 2,
        totalMs: 1503,
      },
      SLOW_MESSAGE,
    )
  })

  it('logs an authorization denial that the resolver spent a second on', async () => {
    const { issuer, warn } = fixture({
      vector: { grantGeneration: 4 },
      instrument: 'both',
      delaysMs: { authorize: 1200 },
    })

    await issuer(admissionInput())

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'authorization_changed', authorizeMs: 1200 }),
      SLOW_MESSAGE,
    )
  })

  it.each<Readonly<{ failAt: Step; fields: Readonly<Record<string, number>> }>>([
    { failAt: 'begin', fields: { totalMs: 1100 } },
    {
      failAt: 'loadControl',
      fields: { beginMs: 10, loadControlMs: 1090, totalMs: 1100 },
    },
    {
      failAt: 'authorize',
      fields: { beginMs: 10, loadControlMs: 0, authorizeMs: 1090, totalMs: 1100 },
    },
    {
      failAt: 'insertPermit',
      fields: {
        beginMs: 10,
        loadControlMs: 0,
        authorizeMs: 0,
        insertPermitMs: 1090,
        totalMs: 1100,
      },
    },
    {
      failAt: 'commit',
      fields: {
        beginMs: 10,
        loadControlMs: 0,
        authorizeMs: 0,
        insertPermitMs: 0,
        commitMs: 1090,
        totalMs: 1100,
      },
    },
  ])(
    'logs an error outcome with the stages reached when $failAt throws slowly, then rethrows',
    async ({ failAt, fields }) => {
      const failure = Object.assign(new Error('connection terminated'), { code: '57P01' })
      const delaysMs: Partial<Record<Step, number>> =
        failAt === 'begin' ? { begin: 1100 } : { begin: 10, [failAt]: 1090 }
      const { issuer, warn } = fixture({
        instrument: 'both',
        delaysMs,
        failAt,
        failure,
      })

      await expect(issuer(admissionInput())).rejects.toBe(failure)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        {
          surface: 'google-execution-permit-issuer',
          stage: 'issuance',
          capability: 'property.import_gbp_v2',
          routeKey: 'google.business-information.locations.list',
          outcome: 'error',
          ...fields,
          errorName: 'Error',
          errorCode: '57P01',
        },
        SLOW_MESSAGE,
      )
    },
  )

  it.each<
    Readonly<{ kind: string; failure: unknown; errorFields: Record<string, string> }>
  >([
    {
      kind: 'an Error without a code',
      failure: new TypeError('bad row'),
      errorFields: { errorName: 'TypeError' },
    },
    { kind: 'a non-Error value', failure: 'aborted', errorFields: {} },
  ])(
    'logs only what $kind safely names when a slow issuance throws it',
    async ({ failure, errorFields }) => {
      const { issuer, warn } = fixture({
        instrument: 'both',
        delaysMs: { begin: 10, insertPermit: 1090 },
        failAt: 'insertPermit',
        failure,
      })

      await expect(issuer(admissionInput())).rejects.toBe(failure)

      expect(warn).toHaveBeenCalledWith(
        {
          surface: 'google-execution-permit-issuer',
          stage: 'issuance',
          capability: 'property.import_gbp_v2',
          routeKey: 'google.business-information.locations.list',
          outcome: 'error',
          beginMs: 10,
          loadControlMs: 0,
          authorizeMs: 0,
          insertPermitMs: 1090,
          totalMs: 1100,
          ...errorFields,
        },
        SLOW_MESSAGE,
      )
    },
  )

  it('rethrows a fast failure without logging', async () => {
    const failure = new Error('connection terminated')
    const { issuer, warn } = fixture({
      instrument: 'both',
      failAt: 'insertPermit',
      failure,
    })

    await expect(issuer(admissionInput())).rejects.toBe(failure)

    expect(warn).not.toHaveBeenCalled()
  })

  it('logs nothing and returns the same result when only the logger is given', async () => {
    const bare = fixture()
    const loggerOnly = fixture({ instrument: 'logger-only', delaysMs: SLOW_STAGES })

    const expected = await bare.issuer(admissionInput())
    const actual = await loggerOnly.issuer(admissionInput())

    expect(actual).toEqual(expected)
    expect(loggerOnly.warn).not.toHaveBeenCalled()
  })

  it('returns the same result and persists the same permit when only the clock is given', async () => {
    const bare = fixture()
    const clockOnly = fixture({ instrument: 'clock-only', delaysMs: SLOW_STAGES })

    const expected = await bare.issuer(admissionInput())
    const actual = await clockOnly.issuer(admissionInput())

    expect(actual).toEqual(expected)
    expect(clockOnly.records).toEqual(bare.records)
    expect(clockOnly.nowMs).not.toHaveBeenCalled()
  })

  it('returns the unchanged result with both timing deps present', async () => {
    const bare = fixture()
    const timed = fixture({ instrument: 'both', delaysMs: SLOW_STAGES })

    const expected = await bare.issuer(admissionInput())
    const actual = await timed.issuer(admissionInput())

    expect(actual).toEqual(expected)
    expect(timed.records).toEqual(bare.records)
  })

  it('keeps every scope id, key and hash out of the logged fields', async () => {
    const { issuer, warn } = fixture({ instrument: 'both', delaysMs: SLOW_STAGES })

    await issuer(admissionInput())

    const logged = JSON.stringify(warn.mock.calls)
    expect(Object.keys(warn.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'authorizeMs',
      'beginMs',
      'capability',
      'commitMs',
      'insertPermitMs',
      'loadControlMs',
      'outcome',
      'routeKey',
      'stage',
      'surface',
      'totalMs',
    ])
    for (const forbidden of [
      'org-1',
      'connection-1',
      'user-1',
      'permit-1',
      'import.start',
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
    ]) {
      expect(logged).not.toContain(forbidden)
    }
  })

  it('keeps the result when the logger itself throws', async () => {
    const { issuer, warn } = fixture({ instrument: 'both', delaysMs: SLOW_STAGES })
    warn.mockImplementation(() => {
      throw new Error('log sink closed')
    })

    await expect(issuer(admissionInput())).resolves.toMatchObject({ ok: true })
  })

  it('rethrows the original failure when the logger throws too', async () => {
    const failure = new Error('connection terminated')
    const { issuer, warn } = fixture({
      instrument: 'both',
      delaysMs: { begin: 1100 },
      failAt: 'begin',
      failure,
    })
    warn.mockImplementation(() => {
      throw new Error('log sink closed')
    })

    await expect(issuer(admissionInput())).rejects.toBe(failure)
  })
})
