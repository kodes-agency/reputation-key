// import-property job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { createImportPropertyHandler } from './import-property.job'

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

describe('import-property job handler', () => {
  it('runs the use case without an in-handler capability gate (delegated to dispatch)', async () => {
    const importPropertyUseCase = vi.fn().mockResolvedValue(undefined)
    const handler = createImportPropertyHandler({
      importPropertyUseCase: importPropertyUseCase as never,
    })

    await handler({ id: 'job-1', data: JOB_DATA } as never)

    expect(importPropertyUseCase).toHaveBeenCalledTimes(1)
  })
})
