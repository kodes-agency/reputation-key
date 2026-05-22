// Integration context — GBP API error type
// Tagged record instead of class — per project convention: no class, use tagged discriminated unions.
// Carries the HTTP status code so callers can make decisions without string parsing.

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
): GbpApiError => ({
  _tag: 'GbpApiError',
  operation,
  status,
  body,
  message: `GBP API ${operation} failed: ${status} ${body}`,
})
