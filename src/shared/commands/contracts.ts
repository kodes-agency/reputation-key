import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { PublicDecisionRequest } from '#/shared/auth/execution-policy'

export type CommandError = Readonly<{
  code: string
  message: string
  context?: Record<string, unknown>
}>

export type CommandErrors<E extends CommandError> = Readonly<{
  name: string
  is: (error: unknown) => error is E
  status: (code: E['code']) => number
}>

export type CommandOptions<E extends CommandError> = Readonly<{
  method: 'GET' | 'POST'
  name: string
  errors: CommandErrors<E>
}>

export type CommandRequest<T> = Readonly<{ data: T; headers: Headers }>

export type TenantCommandOptions<T, E extends CommandError> = CommandOptions<E> &
  Readonly<{
    action: Permission
    propertyId?: (data: T) => string
  }>

export type TenantCommandRequest<T> = CommandRequest<T> & Readonly<{ actor: AuthContext }>

export type PublicCommandScope = Readonly<{
  organizationId: string
  propertyId?: string
}>

export type PublicCommandRequest<T, S extends PublicCommandScope> = CommandRequest<T> &
  Readonly<{ scope: S }>

export type PublicCommandOptions<
  T,
  S extends PublicCommandScope,
  E extends CommandError,
> = CommandOptions<E> &
  Readonly<{
    resolveScope: (request: CommandRequest<T>) => Promise<S>
    limit: (request: PublicCommandRequest<T, S>) => Promise<void>
    execution: (
      request: PublicCommandRequest<T, S>,
    ) => Omit<
      PublicDecisionRequest,
      'organizationId' | 'propertyId' | 'now' | 'correlationId'
    >
  }>
