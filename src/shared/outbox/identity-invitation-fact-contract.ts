/**
 * Temporary rolling-contract adapter for `identity.member.invited`.
 *
 * The pre-cutover v1 parser requires an `email` string, but durable queue
 * payloads must not retain the invitee address. Preserve only the structural
 * sentinel until every consumer understands v2. The PostgreSQL trigger owns
 * authoritative issuance; this adapter closes the relay/in-memory race for
 * rows claimed immediately before the operator switches versions.
 */
const IDENTITY_MEMBER_INVITED_EVENT_TYPE = 'identity.member.invited'
const REDACTED_INVITEE_EMAIL = '[redacted]'
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeIdentityInvitationQueuePayload(
  eventType: string,
  eventVersion: number,
  payload: unknown,
): unknown {
  if (eventType !== IDENTITY_MEMBER_INVITED_EVENT_TYPE || !isRecord(payload)) {
    return payload
  }
  if (eventVersion === 1) {
    return { ...payload, email: REDACTED_INVITEE_EMAIL }
  }
  if ('email' in payload) {
    const { email: _email, ...clean } = payload
    return clean
  }
  return payload
}

/**
 * Sanitize retained invitation work at every generic quarantine-redrive
 * boundary. This closes a move race in which a verifier could scan the target
 * before the add and the quarantine after the remove. The redrive itself can
 * therefore never move a private invitation fact, irrespective of scan order.
 */
export function sanitizeIdentityInvitationRedriveData(
  jobName: string,
  data: unknown,
): unknown {
  if (!isRecord(data)) return data

  if (
    jobName === 'insert-activity-log' &&
    data.action === 'invited' &&
    data.resourceType === 'member' &&
    isRecord(data.payload) &&
    data.payload.detail != null
  ) {
    return { ...data, payload: { ...data.payload, detail: null } }
  }

  if (jobName !== IDENTITY_MEMBER_INVITED_EVENT_TYPE) {
    return data
  }

  // Pre-BQR relay compatibility: the earliest durable jobs used the validated
  // event payload directly instead of the ConsumerEvent envelope. Those jobs
  // are not dispatchable by the current worker, but they must still be made
  // content-free before retention/redrive.
  if (data.eventType !== IDENTITY_MEMBER_INVITED_EVENT_TYPE) {
    if (!('email' in data)) return data
    const { email: _email, ...bare } = data
    return bare
  }
  if (!isRecord(data.payload)) return data

  const payload = sanitizeIdentityInvitationQueuePayload(
    data.eventType,
    data.eventVersion === 1 ? 1 : 2,
    data.payload,
  )
  return payload === data.payload ? data : { ...data, payload }
}

function isIdentityInvitationWork(jobName: string, data: unknown): boolean {
  if (!isRecord(data)) return false
  return (
    (jobName === 'insert-activity-log' &&
      data.action === 'invited' &&
      data.resourceType === 'member') ||
    jobName === IDENTITY_MEMBER_INVITED_EVENT_TYPE
  )
}

function invitationPrivateValues(jobName: string, data: unknown): readonly string[] {
  if (!isRecord(data)) return []
  if (
    jobName === 'insert-activity-log' &&
    isRecord(data.payload) &&
    typeof data.payload.detail === 'string'
  ) {
    return [data.payload.detail]
  }
  if (
    jobName === IDENTITY_MEMBER_INVITED_EVENT_TYPE &&
    ((isRecord(data.payload) && typeof data.payload.email === 'string') ||
      typeof data.email === 'string')
  ) {
    return [
      isRecord(data.payload) && typeof data.payload.email === 'string'
        ? data.payload.email
        : (data.email as string),
    ]
  }
  return []
}

/**
 * Build content-safe fields before any invitation job is added to quarantine.
 * Safety does not depend on the publishing process retaining its BullMQ lock:
 * even a late write from a suspended/lost-lock attempt contains no invitation
 * address or Activity detail in either payload or failure reason.
 */
export function sanitizeIdentityInvitationQuarantineFields(
  jobName: string,
  data: unknown,
  failedReason: string,
): Readonly<{ data: unknown; failedReason: string }> {
  if (!isIdentityInvitationWork(jobName, data)) return { data, failedReason }

  let safeReason = failedReason
  for (const value of invitationPrivateValues(jobName, data)) {
    if (value && value !== REDACTED_INVITEE_EMAIL) {
      safeReason = safeReason.split(value).join(REDACTED_INVITEE_EMAIL)
    }
  }
  safeReason = safeReason.replace(EMAIL_LIKE, REDACTED_INVITEE_EMAIL)
  return {
    data: sanitizeIdentityInvitationRedriveData(jobName, data),
    failedReason: safeReason,
  }
}
