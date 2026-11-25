import { describe, expect, it } from 'vitest'
import { getLogger } from '#/shared/observability/logger'
import type { AiExecutionAdmission } from './execution-admission'
import type { PreparedInvocationBase } from './provider-contracts'
import {
  logProviderAttestationThrow,
  logProviderGateRefusal,
  logProviderPreDispatchThrow,
  writeGatewayEvent,
} from './connector-diagnostics'

const invocation = {
  descriptor: {
    route: 'review-analysis',
    operationId: '10000000-0000-4000-8000-000000000001',
    permitId: '10000000-0000-4000-8000-000000000002',
    attemptNumber: 2,
  },
} as unknown as Pick<PreparedInvocationBase, 'descriptor'>

// The real logger over a captured destination: the level label, the message and
// the sanitiser are all the ones a gateway line meets in production.
const lines: string[] = []
getLogger({ write: (line: string) => lines.push(line) })

const lastLine = (): Record<string, unknown> =>
  JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>

describe('provider connector diagnostics', () => {
  it('logs only bounded content-free gate facts, as an error', () => {
    const admission = { expiresAtEpochMillis: 7_000 } as unknown as AiExecutionAdmission

    logProviderGateRefusal(invocation, admission, 1_000, ['admission_expired'])

    expect(lastLine()).toMatchObject({
      level: 'error',
      msg: 'gateway_no_dispatch',
      event: 'gateway_no_dispatch',
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      permitId: '10000000-0000-4000-8000-000000000002',
      attempt: 2,
      admissionTtlMillis: 6_000,
      reasons: ['admission_expired'],
    })
  })

  it('omits attestation error content', () => {
    logProviderAttestationThrow(invocation, new TypeError('x'.repeat(240)))

    const record = lastLine()
    expect(record).toMatchObject({
      level: 'error',
      event: 'gateway_no_dispatch',
      stage: 'attestation_threw',
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      error: { name: 'TypeError' },
    })
    expect(JSON.stringify(record)).not.toContain('xxxx')
  })

  it('records whether pre-dispatch resources had been allocated', () => {
    logProviderPreDispatchThrow(invocation, 'refused', true, false)

    expect(lastLine()).toMatchObject({
      level: 'error',
      event: 'gateway_no_dispatch',
      stage: 'dispatch_threw_before_outbound',
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      pinnedNull: true,
      boundaryNull: false,
      error: { name: 'UnknownError' },
    })
  })
})

describe('gateway event levels', () => {
  it.each([
    ['gateway_admission_unavailable', 'error'],
    ['gateway_no_dispatch', 'error'],
    ['gateway_execute_threw', 'error'],
    ['gateway_settlement_rejected', 'error'],
    ['gateway_usage_unknown', 'warn'],
    ['gateway_post_settlement_expiry', 'warn'],
    ['gateway_disposition_rewritten', 'warn'],
    ['anthropic_refusal', 'warn'],
    ['anthropic_output_truncated', 'warn'],
    ['openai_output_truncated', 'warn'],
    ['canary_second_call_rejected', 'warn'],
    ['canary_response_json_rejected', 'warn'],
    ['canary_output_invalid', 'warn'],
    ['canary_usage_rejected', 'warn'],
    ['an_event_nobody_listed', 'warn'],
    ['constructor', 'warn'],
  ])('logs %s at %s, with the event name as the message', (event, level) => {
    writeGatewayEvent({ event, route: 'review-analysis' })

    expect(lastLine()).toMatchObject({
      level,
      msg: event,
      event,
      route: 'review-analysis',
    })
  })

  it('still logs a line that carries no event name, as a warning', () => {
    writeGatewayEvent({ route: 'review-analysis' })

    expect(lastLine()).toMatchObject({ level: 'warn', msg: 'gateway_event' })
  })

  it('keeps the fields the gateway events carry', () => {
    const fields = {
      route: 'review-analysis',
      operationId: '10000000-0000-4000-8000-000000000001',
      permitId: '10000000-0000-4000-8000-000000000002',
      attempt: 1,
      stage: 'pre_connector',
      reason: 'admission_ttl_too_short',
      reasons: ['admission_expired'],
      invariant: 'total_tokens',
      successSettled: false,
      stopReason: 'max_tokens',
      outputTokens: 12,
      replyTokenExpired: false,
      method: 'POST',
      path: '/v1/responses',
      contentType: 'application/json',
    }

    writeGatewayEvent({ event: 'gateway_no_dispatch', ...fields })

    expect(lastLine()).toMatchObject(fields)
  })

  it('reduces a thrown error to its class, whatever the event', () => {
    writeGatewayEvent({
      event: 'canary_output_invalid',
      reason: 'post_200_throw',
      error: {
        name: 'SyntaxError',
        message: 'private text',
        stack: 'at private',
        cause: null,
      },
    })

    const record = lastLine()
    expect(record.error).toEqual({ name: 'SyntaxError' })
    expect(JSON.stringify(record)).not.toContain('private')
  })
})
