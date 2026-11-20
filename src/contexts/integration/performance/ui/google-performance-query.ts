import type { PropertyGooglePerformanceResultV1 } from '#/shared/google-performance-report-contract'

export type PerformanceErrorResult = Extract<
  PropertyGooglePerformanceResultV1,
  { status: 'error' }
>

export class PerformanceQueryError extends Error {
  readonly result: PerformanceErrorResult

  constructor(result: PerformanceErrorResult) {
    super(result.errorCode)
    this.name = 'PerformanceQueryError'
    this.result = result
  }
}

export function toPerformanceErrorResult(
  error: Error | null,
  isError: boolean,
): PerformanceErrorResult | null {
  if (error instanceof PerformanceQueryError) return error.result
  if (!isError) return null
  return {
    status: 'error',
    errorCode: 'temporarily_unavailable',
    retryable: true,
    retryAfterSeconds: null,
  }
}
