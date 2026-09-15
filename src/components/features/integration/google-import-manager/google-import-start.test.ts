import { describe, expect, it, vi } from 'vitest'
import type { StartPropertyImportItemInput } from '#/contexts/integration/application/public-api'
import { startGoogleImport, type GoogleImportStartDeps } from './google-import-start'

const REQUEST_ID = '10000000-0000-4000-8000-000000000001'
const IMPORT_JOB_ID = '10000000-0000-4000-8000-000000000002'

const items: readonly StartPropertyImportItemInput[] = Object.freeze([
  Object.freeze({
    candidateRef: 'candidate.ref',
    action: 'create' as const,
    profile: Object.freeze({
      name: 'Harbor Hotel',
      address: null,
      countryCode: 'GB',
      timezone: 'Europe/London',
      confirmed: true as const,
    }),
  }),
])

function harness(over: Partial<GoogleImportStartDeps> = {}) {
  const calls: string[] = []
  const deps: GoogleImportStartDeps = {
    requestId: REQUEST_ID,
    items,
    start: vi.fn(async () => {
      calls.push('start')
      return { importJobId: IMPORT_JOB_ID, requestId: REQUEST_ID }
    }),
    recover: vi.fn(async () => {
      calls.push('recover')
      return null
    }),
    isCurrent: () => true,
    navigateToRequest: vi.fn(async () => {
      calls.push('navigate')
    }),
    openProgress: vi.fn(async () => {
      calls.push('open')
    }),
    ...over,
  }
  return { deps, calls }
}

describe('startGoogleImport', () => {
  it('names the request in the URL only after the server committed it', async () => {
    const { deps, calls } = harness()

    await expect(startGoogleImport(deps)).resolves.toEqual({
      kind: 'started',
      importJobId: IMPORT_JOB_ID,
    })
    expect(calls).toEqual(['start', 'navigate', 'open'])
    expect(deps.start).toHaveBeenCalledWith({
      data: { requestId: REQUEST_ID, items, confirmation: 'apply' },
    })
    expect(deps.navigateToRequest).toHaveBeenCalledWith(REQUEST_ID)
    expect(deps.openProgress).toHaveBeenCalledWith(IMPORT_JOB_ID)
    expect(deps.recover).not.toHaveBeenCalled()
  })

  it('reports a failed start in place without navigating', async () => {
    const error = Object.assign(new Error('failed: invalid_reference'), {
      code: 'invalid_reference',
    })
    const { deps, calls } = harness({
      start: vi.fn(async () => {
        calls.push('start')
        throw error
      }),
    })

    await expect(startGoogleImport(deps)).resolves.toEqual({ kind: 'failed', error })
    // The request id is checked before the failure is believed.
    expect(calls).toEqual(['start', 'recover'])
    expect(deps.navigateToRequest).not.toHaveBeenCalled()
    expect(deps.openProgress).not.toHaveBeenCalled()
  })

  it('opens an import that committed although its response was lost', async () => {
    const { deps, calls } = harness({
      start: vi.fn(async () => {
        calls.push('start')
        throw new TypeError('Failed to fetch')
      }),
      recover: vi.fn(async () => {
        calls.push('recover')
        return IMPORT_JOB_ID
      }),
    })

    await expect(startGoogleImport(deps)).resolves.toEqual({
      kind: 'recovered',
      importJobId: IMPORT_JOB_ID,
    })
    expect(calls).toEqual(['start', 'recover', 'navigate', 'open'])
  })

  it('refuses a receipt for another request and recovers its own instead', async () => {
    const { deps, calls } = harness({
      start: vi.fn(async () => {
        calls.push('start')
        return { importJobId: 'other-job', requestId: 'other-request' }
      }),
    })

    const outcome = await startGoogleImport(deps)

    expect(outcome.kind).toBe('failed')
    expect(calls).toEqual(['start', 'recover'])
    expect(deps.openProgress).not.toHaveBeenCalledWith('other-job')
  })

  it('leaves the manager where they are once the view has moved on', async () => {
    const { deps, calls } = harness({ isCurrent: () => false })

    await expect(startGoogleImport(deps)).resolves.toEqual({ kind: 'abandoned' })
    expect(calls).toEqual(['start'])
  })

  it('surfaces a progress failure after the URL already names the import', async () => {
    const { deps, calls } = harness({
      openProgress: vi.fn(async () => {
        calls.push('open')
        throw new Error('status unavailable')
      }),
    })

    await expect(startGoogleImport(deps)).rejects.toThrow('status unavailable')
    expect(calls).toEqual(['start', 'navigate', 'open'])
  })
})
