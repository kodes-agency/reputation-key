import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

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
    propertyId?: (data: T) => string | undefined
  }>

export type TenantCommandRequest<T> = CommandRequest<T> & Readonly<{ actor: AuthContext }>
