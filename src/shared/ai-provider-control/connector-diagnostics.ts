import { summarizeError } from '#/shared/observability/error-summary'
import type { AiExecutionAdmission } from './execution-admission'
import type { PreparedInvocationBase } from './provider-contracts'

type DiagnosticInvocation = Pick<PreparedInvocationBase, 'descriptor'>

/** One structured diagnostic line on stderr, for a gateway exit that would otherwise be silent. */
export function writeGatewayEvent(event: Readonly<Record<string, unknown>>): void {
  process.stderr.write(`${JSON.stringify(event)}\n`)
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
