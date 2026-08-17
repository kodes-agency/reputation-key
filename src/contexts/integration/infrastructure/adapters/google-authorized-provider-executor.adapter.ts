import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'

export type GoogleProviderPermitAdmission = Readonly<{
  authorization: GoogleProviderCallAuthorization
  admission: GoogleProviderAdmissionMetadata
}>

export type GoogleProviderPermitAdmitter = (
  input: GoogleProviderPermitAdmission,
) => Promise<
  Readonly<{ ok: true; permitId: string }> | Readonly<{ ok: false; code: string }>
>

type GoogleEgressGatewayClient = Readonly<{
  execute(
    input: Readonly<{
      permitId: string
      descriptor: GoogleProviderRouteDescriptor
      deadlineMs: number
    }>,
  ): Promise<GoogleProviderExecutionResult>
}>

export function createGoogleAuthorizedProviderExecutor(
  deps: Readonly<{
    bindCredential: (credential: string) => string
    admit: GoogleProviderPermitAdmitter
    gateway: GoogleEgressGatewayClient
    routeTarget?: GoogleProviderRouteTarget
    logger?: Readonly<{
      warn(fields: Readonly<Record<string, unknown>>, message: string): void
    }>
  }>,
): GoogleAuthorizedProviderExecutor {
  return Object.freeze({
    execute: async (descriptor, options) => {
      if (options.signal?.aborted) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      let admission: GoogleProviderAdmissionMetadata
      try {
        admission = compileGoogleProviderRequest(
          descriptor,
          deps.bindCredential,
          deps.routeTarget,
        ).admission
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'compile', code: 'malformed_request' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'malformed_request', retryAfterMs: 0 }
      }
      let permit: Awaited<ReturnType<GoogleProviderPermitAdmitter>>
      try {
        permit = await deps.admit({ authorization: options.authorization, admission })
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'admit', code: 'admission_error' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'admission_denied', retryAfterMs: 0 }
      }
      if (!permit.ok) {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'admit', code: permit.code },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'admission_denied', retryAfterMs: 0 }
      }
      if (options.signal?.aborted) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      try {
        return await deps.gateway.execute({
          permitId: permit.permitId,
          descriptor,
          deadlineMs: options.deadlineMs,
        })
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'gateway', code: 'transport_error' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'transport_error', retryAfterMs: 0 }
      }
    },
  })
}
