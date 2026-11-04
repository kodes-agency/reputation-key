// What a refused Google read may say about itself: the HTTP status, the machine
// status of Google's error body, and whether the request was dispatched. Every
// value is closed, so the result is safe to log and to store. A status outside
// the list, a message, a resource name and any other field of the body are
// dropped.

/** The `google.rpc.Code` names Google's JSON error bodies carry as `error.status`. */
const GOOGLE_ERROR_STATUSES = [
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
] as const

export type GoogleProviderErrorStatus = (typeof GOOGLE_ERROR_STATUSES)[number]

/** Exact machine statuses only; a plausible-looking arbitrary code is not safe. */
export function googleProviderErrorStatus(
  value: unknown,
): GoogleProviderErrorStatus | null {
  return GOOGLE_ERROR_STATUSES.find((status) => status === value) ?? null
}

export type GoogleProviderFailure = Readonly<{
  providerStatus: number | null
  providerErrorStatus: GoogleProviderErrorStatus | null
  dispatch: 'answered' | 'not_sent' | 'unknown'
}>

/** Rebuild at storage/log boundaries; never copy an error or its body. */
export function googleProviderFailure(value: unknown): GoogleProviderFailure {
  const fields = typeof value === 'object' && value !== null ? value : {}
  const status = 'providerStatus' in fields ? fields.providerStatus : null
  const dispatch = 'dispatch' in fields ? fields.dispatch : null
  return {
    providerStatus:
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : null,
    providerErrorStatus: googleProviderErrorStatus(
      'providerErrorStatus' in fields ? fields.providerErrorStatus : null,
    ),
    dispatch: dispatch === 'answered' || dispatch === 'not_sent' ? dispatch : 'unknown',
  }
}
