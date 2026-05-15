// Integration context — GBP API error class
// Carries the HTTP status code so callers can make decisions without string parsing.

export class GbpApiError extends Error {
  readonly status: number

  constructor(operation: string, status: number, body: string) {
    super(`GBP API ${operation} failed: ${status} ${body}`)
    this.name = 'GbpApiError'
    this.status = status
  }
}
