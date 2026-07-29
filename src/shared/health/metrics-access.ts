// BQC-7.2 — operator token gate for /api/health/metrics (private ops
// diagnostics; the platform probes /live /ready /started stay unauthenticated).
//
// Fail-closed: the route 404s — NOT 403, so probing clients cannot
// distinguish "endpoint exists, wrong credential" from "no such route" —
// when OPS_METRICS_TOKEN is unset OR the presented credential does not
// match. Accepted credentials: the `x-ops-token` header or
// `Authorization: Bearer <token>`.
//
// The comparison hashes both sides (sha256) before timingSafeEqual so the
// check is constant-time without leaking the expected token's length.

import { createHash, timingSafeEqual } from 'node:crypto'

const BEARER_RE = /^Bearer\s+(\S+)\s*$/i

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** True only when an operator credential is configured AND presented. */
export function isMetricsAuthorized(
  headers: Headers,
  envToken: string | undefined,
): boolean {
  if (!envToken) return false
  const bearer = BEARER_RE.exec(headers.get('authorization') ?? '')?.[1]
  const presented = headers.get('x-ops-token') ?? bearer
  if (!presented) return false
  return timingSafeEqual(digest(presented), digest(envToken))
}
