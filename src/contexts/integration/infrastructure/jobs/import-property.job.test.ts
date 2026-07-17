// BQC-0.4 — import job must honor the capability stop control.
// An enqueued import must not call Google after the capability is switched off.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createImportPropertyHandler } from './import-property.job'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: () => true,
    isOrgAllowlisted: () => false,
    isPropertyAllowlisted: () => true,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

const JOB_DATA = {
  jobId: 'job-1',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  locations: [
    {
      gbpPlaceId: 'place-1',
      businessName: 'Test Hotel',
      gbpLocationName: 'accounts/111/locations/222',
      countryCode: 'BG',
    },
  ],
}

describe('import-property job capability gate (BQC-0.4)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('does not call the use case when property.connect_gbp is switched off', async () => {
    initCapabilityPolicyStore(
      makeStore({
        isCapabilityGloballyEnabled: (cap) => cap !== 'property.connect_gbp',
      }),
    )
    const importPropertyUseCase = vi.fn().mockResolvedValue(undefined)
    const handler = createImportPropertyHandler({
      importPropertyUseCase: importPropertyUseCase as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(importPropertyUseCase).not.toHaveBeenCalled()
  })

  it('runs the use case when the capability is enabled', async () => {
    initCapabilityPolicyStore(makeStore())
    const importPropertyUseCase = vi.fn().mockResolvedValue(undefined)
    const handler = createImportPropertyHandler({
      importPropertyUseCase: importPropertyUseCase as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(importPropertyUseCase).toHaveBeenCalledTimes(1)
  })
})
