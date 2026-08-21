import { createHmac } from 'node:crypto'

export type OAuthCallbackAbuseDenyCode =
  'pre_state_quota_exhausted' | 'tenant_quota_exhausted' | 'quota_unavailable'

export type OAuthCallbackAbuseResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; code: OAuthCallbackAbuseDenyCode }>

export type OAuthCallbackAbuseGate = Readonly<{
  admitPreState(
    input: Readonly<{
      sessionId: string | null
      trustedSourceId: string | null
      nowMs: number
    }>,
  ): Promise<OAuthCallbackAbuseResult>
  admitResolvedTenant(
    input: Readonly<{
      organizationId: string
      userId: string
      nowMs: number
    }>,
  ): Promise<OAuthCallbackAbuseResult>
}>

export type OAuthCallbackQuotaCounter = Readonly<{
  consume(
    input: Readonly<{
      audience: 'pre_state' | 'resolved_tenant'
      projectKey: string
      subjectKey: string
      limit: number
      windowMs: number
      nowMs: number
    }>,
  ): Promise<boolean>
}>

const PRE_STATE_LIMIT = 30
const TENANT_LIMIT = 20
const WINDOW_MS = 60_000

function digest(secret: string, audience: string, value: string): string {
  return createHmac('sha256', secret)
    .update(`${audience}\0${value}`, 'utf8')
    .digest('base64url')
}

export function createOAuthCallbackAbuseGate(
  input: Readonly<{
    counter: OAuthCallbackQuotaCounter
    hmacSecret: string
    projectIdentity: string
  }>,
): OAuthCallbackAbuseGate {
  if (input.hmacSecret.length < 32 || input.projectIdentity.length === 0) {
    throw new Error('OAuth callback abuse gate configuration is invalid')
  }
  const projectKey = digest(
    input.hmacSecret,
    'oauth-callback-project-v1',
    input.projectIdentity,
  )

  const consume = async (
    audience: 'pre_state' | 'resolved_tenant',
    subject: string,
    limit: number,
    nowMs: number,
  ): Promise<OAuthCallbackAbuseResult> => {
    try {
      const allowed = await input.counter.consume({
        audience,
        projectKey,
        subjectKey: digest(input.hmacSecret, `oauth-callback-${audience}-v1`, subject),
        limit,
        windowMs: WINDOW_MS,
        nowMs,
      })
      return allowed
        ? { ok: true }
        : {
            ok: false,
            code:
              audience === 'pre_state'
                ? 'pre_state_quota_exhausted'
                : 'tenant_quota_exhausted',
          }
    } catch {
      return { ok: false, code: 'quota_unavailable' }
    }
  }

  return Object.freeze({
    admitPreState: (request) =>
      consume(
        'pre_state',
        request.sessionId
          ? `session:${request.sessionId}`
          : `source:${request.trustedSourceId ?? 'untrusted-sessionless'}`,
        PRE_STATE_LIMIT,
        request.nowMs,
      ),
    admitResolvedTenant: (request) =>
      consume(
        'resolved_tenant',
        `${request.organizationId}\0${request.userId}`,
        TENANT_LIMIT,
        request.nowMs,
      ),
  })
}

export function createInMemoryOAuthCallbackQuotaCounter(): OAuthCallbackQuotaCounter {
  const counters = new Map<string, { window: number; count: number }>()
  return Object.freeze({
    consume: async (input) => {
      if (
        !Number.isSafeInteger(input.nowMs) ||
        !Number.isSafeInteger(input.windowMs) ||
        !Number.isSafeInteger(input.limit) ||
        input.windowMs < 1 ||
        input.limit < 1
      ) {
        return false
      }
      const window = Math.floor(input.nowMs / input.windowMs)
      const key = `${input.audience}:${input.projectKey}:${input.subjectKey}`
      const current = counters.get(key)
      const count = current?.window === window ? current.count + 1 : 1
      counters.set(key, { window, count })
      return count <= input.limit
    },
  })
}
