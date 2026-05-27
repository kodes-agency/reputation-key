// Staff context — domain errors

export type StaffErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'assignment_not_found'
  | 'already_assigned'
  | 'property_not_found'
  | 'team_not_found'

export type StaffError = Readonly<{
  _tag: 'StaffError'
  code: StaffErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const staffError = (
  code: StaffErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): StaffError => ({
  _tag: 'StaffError',
  code,
  message,
  ...(context ? { context } : {}),
})

export const isStaffError = (e: unknown): e is StaffError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'StaffError'
