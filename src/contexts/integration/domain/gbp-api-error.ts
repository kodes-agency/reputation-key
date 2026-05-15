// Integration context — GBP API error type
// Tagged union instead of class — per project convention: no class, use tagged discriminated unions.
// Carries the HTTP status code so callers can make decisions without string parsing.
//
// DESIGN NOTE: This is a hybrid — a tagged union (GbpApiError type) grafted onto Error via
// Object.defineProperties. The hybrid is necessary because pino serializes Error instances
// properly (message + stack), but would render a plain object as JSON noise. The _tag field
// enables isGbpApiError() type guards. If pino serialization is no longer needed, this can
// revert to a pure tagged union like IntegrationError.

export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  status: number
  body: string
  message: string
}>

export const createGbpApiError = (
  operation: string,
  status: number,
  body: string,
): Error & GbpApiError => {
  const error = new Error(`GBP API ${operation} failed: ${status} ${body}`)
  const tagged = error as Error & GbpApiError
  Object.defineProperties(tagged, {
    _tag: { value: 'GbpApiError', enumerable: true },
    operation: { value: operation, enumerable: true },
    status: { value: status, enumerable: true },
    body: { value: body, enumerable: true },
  })
  return tagged
}
