import type { AiExecutionGrantV1 } from '#/shared/ai-internal-transport-contract'
import type { PreparedInvocationBase } from './provider-contracts'

type DiagnosticInvocation = Pick<PreparedInvocationBase, 'descriptor'>

export function logProviderGateRefusal(
  invocation: DiagnosticInvocation,
  grant: AiExecutionGrantV1,
  currentTime: number,
  reasons: readonly string[],
): void {
  process.stderr.write(
    `${JSON.stringify({
      event: 'gateway_no_dispatch',
      route: invocation.descriptor.route,
      operationId: invocation.descriptor.operationId,
      permitId: invocation.descriptor.permitId,
      attempt: invocation.descriptor.attemptNumber,
      grantTtlMillis: grant.expiresAtEpochMillis - currentTime,
      reasons,
    })}\n`,
  )
}

export function logProviderAttestationThrow(
  invocation: DiagnosticInvocation,
  error: unknown,
): void {
  process.stderr.write(
    `${JSON.stringify({
      event: 'gateway_no_dispatch',
      stage: 'attestation_threw',
      route: invocation.descriptor.route,
      operationId: invocation.descriptor.operationId,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 200)
          : String(error).slice(0, 200),
    })}\n`,
  )
}

export function logProviderPreDispatchThrow(
  invocation: DiagnosticInvocation,
  error: unknown,
  pinnedNull: boolean,
  boundaryNull: boolean,
): void {
  process.stderr.write(
    `${JSON.stringify({
      event: 'gateway_no_dispatch',
      stage: 'dispatch_threw_before_outbound',
      route: invocation.descriptor.route,
      operationId: invocation.descriptor.operationId,
      pinnedNull,
      boundaryNull,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error).slice(0, 300),
    })}\n`,
  )
}
