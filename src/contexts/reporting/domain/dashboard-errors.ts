// Dashboard context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type DashboardErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  /** A Property has more Portals than one results read answers for; retrying cannot help. */
  | 'too_many_portals'

export type DashboardError = Readonly<{
  _tag: 'DashboardError'
  code: DashboardErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const dashboardError = createErrorFactory<
  DashboardError['_tag'],
  DashboardError['code']
>('DashboardError')

export const isDashboardError = (e: unknown): e is DashboardError =>
  typeof e === 'object' && e !== null && (e as DashboardError)._tag === 'DashboardError'
