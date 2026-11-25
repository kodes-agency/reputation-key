import { summarizeError } from '#/shared/observability/error-summary'
import { getLogger } from '#/shared/observability/logger'
import type { AiExecutionAdmission } from './execution-admission'
import type { PreparedInvocationBase } from './provider-contracts'

type DiagnosticInvocation = Pick<PreparedInvocationBase, 'descriptor'>

type GatewayEventLevel = 'error' | 'warn'

/**
 * How loudly each gateway event is logged. `error`: the gateway failed to do its
 * job (a call that never dispatched, a throw out of execution, a settlement the
 * ledger refused). `warn`: a degraded outcome the gateway handled (an unknown
 * charge, a late expiry, a rewritten disposition, a truncated or refused answer,
 * a rejected canary). An event not named here is a `warn`.
 */
const GATEWAY_EVENT_LEVELS: ReadonlyMap<string, GatewayEventLevel> = new Map([
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
])

const UNNAMED_GATEWAY_EVENT = 'gateway_event'

/**
 * One diagnostic line for a gateway exit that would otherwise be silent, sent
 * through the shared logger: levelled, sanitised and trace-linked like every
 * other line. The event's fields stay as they are; the message is its name.
 */
export function writeGatewayEvent(event: Readonly<Record<string, unknown>>): void {
  const name = typeof event.event === 'string' ? event.event : UNNAMED_GATEWAY_EVENT
  const level = GATEWAY_EVENT_LEVELS.get(name) ?? 'warn'
  getLogger()[level](event, name)
}

export function logProviderGateRefusal(
  invocation: DiagnosticInvocation,
  admission: AiExecutionAdmission,
  currentTime: number,
  reasons: readonly string[],
): void {
  writeGatewayEvent({
    event: 'gateway_no_dispatch',
    route: invocation.descriptor.route,
    operationId: invocation.descriptor.operationId,
    permitId: invocation.descriptor.permitId,
    attempt: invocation.descriptor.attemptNumber,
    admissionTtlMillis: admission.expiresAtEpochMillis - currentTime,
    reasons,
  })
}

export function logProviderAttestationThrow(
  invocation: DiagnosticInvocation,
  error: unknown,
): void {
  writeGatewayEvent({
    event: 'gateway_no_dispatch',
    stage: 'attestation_threw',
    route: invocation.descriptor.route,
    operationId: invocation.descriptor.operationId,
    error: summarizeError(error),
  })
}

export function logProviderPreDispatchThrow(
  invocation: DiagnosticInvocation,
  error: unknown,
  pinnedNull: boolean,
  boundaryNull: boolean,
): void {
  writeGatewayEvent({
    event: 'gateway_no_dispatch',
    stage: 'dispatch_threw_before_outbound',
    route: invocation.descriptor.route,
    operationId: invocation.descriptor.operationId,
    pinnedNull,
    boundaryNull,
    error: summarizeError(error),
  })
}
