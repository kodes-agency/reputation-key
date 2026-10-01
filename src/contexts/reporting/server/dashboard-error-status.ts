// Reporting — how a DashboardError code is answered over HTTP. The three standard
// codes keep the shared mapping; a Property too large for one read is a 422, not
// a failure the reader can retry away.

import { HTTP_STATUS, standardErrorStatus } from '#/shared/http/status'
import type { DashboardErrorCode } from '../domain/dashboard-errors'

export function dashboardErrorStatus(code: DashboardErrorCode): number {
  return code === 'too_many_portals'
    ? HTTP_STATUS.UNPROCESSABLE
    : standardErrorStatus(code)
}
