import { describe, expect, it, vi } from 'vitest'
import type { AiExecutionGrantV1 } from '#/shared/ai-internal-transport-contract'
import type { PreparedInvocationBase } from './provider-contracts'
import {
  logProviderAttestationThrow,
  logProviderGateRefusal,
  logProviderPreDispatchThrow,
} from './connector-diagnostics'

const invocation = {
  descriptor: {
    route: 'review-analysis',
    operationId: '10000000-0000-4000-8000-000000000001',
    permitId: '10000000-0000-4000-8000-000000000002',
    attemptNumber: 2,
  },
} as unknown as Pick<PreparedInvocationBase, 'descriptor'>

describe('provider connector diagnostics', () => {
  it('writes only bounded content-free gate facts', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const grant = { expiresAtEpochMillis: 7_000 } as unknown as AiExecutionGrantV1

    logProviderGateRefusal(invocation, grant, 1_000, ['grant_expired'])

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        event: 'gateway_no_dispatch',
        route: 'review-analysis',
        operationId: '10000000-0000-4000-8000-000000000001',
        permitId: '10000000-0000-4000-8000-000000000002',
        attempt: 2,
        grantTtlMillis: 6_000,
        reasons: ['grant_expired'],
      })}\n`,
    )
    write.mockRestore()
  })

  it('bounds attestation errors without serializing provider content', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const message = 'x'.repeat(240)

    logProviderAttestationThrow(invocation, new TypeError(message))

    const record = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(record).toEqual({
      event: 'gateway_no_dispatch',
      stage: 'attestation_threw',
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      errorName: 'TypeError',
      errorMessage: 'x'.repeat(200),
    })
    write.mockRestore()
  })

  it('records whether pre-dispatch resources had been allocated', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    logProviderPreDispatchThrow(invocation, 'refused', true, false)

    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      event: 'gateway_no_dispatch',
      stage: 'dispatch_threw_before_outbound',
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      pinnedNull: true,
      boundaryNull: false,
      errorName: 'unknown',
      errorMessage: 'refused',
    })
    write.mockRestore()
  })
})
