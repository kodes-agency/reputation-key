// Dashboard context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type DashboardErrorCode = 'forbidden' | 'not_found' | 'invalid_input'

export type DashboardError = Readonly<{
  _tag: 'DashboardError'
  code: DashboardErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const dashboardError = createErrorFactory<DashboardError['_tag']>('DashboardError')

export const isDashboardError = (e: unknown): e is DashboardError =>
  typeof e === 'object' && e !== null && (e as DashboardError)._tag === 'DashboardError'
