// Staff context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type StaffErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'participation_not_found'
  | 'participation_archived'
  | 'responsibility_conflict'
  | 'revision_conflict'
  | 'property_not_found'
export type StaffError = Readonly<{
  _tag: 'StaffError'
  code: StaffErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const staffError = createErrorFactory<StaffError['_tag'], StaffError['code']>(
  'StaffError',
)

export const isStaffError = (e: unknown): e is StaffError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'StaffError'
