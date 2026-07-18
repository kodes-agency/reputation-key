// BQC-3.9 — per-family durable cutover flags (phase BQC-3 §7).
//
// Each inbox projection family moves through three states independently:
//
//   record-only — facts are recorded to the outbox atomically with the source
//                 write; the in-process bus stays the primary projection path.
//                 Today's production posture (the durable dispatcher is off).
//   shadow      — BOTH paths run: the durable dispatcher must be enabled and
//                 the shadow-compare harness contrasts the projection outcome
//                 of each path for the same event (match/mismatch, field names
//                 only — never content). External-effect consumers stay
//                 idempotent so dual delivery cannot double side effects.
//   switch      — the durable path is authoritative for the family; the
//                 family's in-process bus handlers are NOT registered (legacy
//                 primary retired for that family — flag-gated, never deleted).
//
// Rollback is the reverse flag move (§7): back to record-only disables
// durable consumption for the family, the outbox/backlog is preserved, and
// the bus handlers re-register on the next boot — they cannot duplicate
// external effects because the only external-effect consumers (review sync
// enqueue, publication cancel) are idempotent by jobId/state.
//
// Env encoding — deliberately the simplest honest form (no JSON document):
//
//   DURABLE_CUTOVER_INBOX                        group default for all four
//   DURABLE_CUTOVER_INBOX_REVIEW_CREATED         per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_UPDATED         per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED         per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED per-family override
//
// Precedence: per-family var > group var > 'record-only'. Values parse
// case-insensitively; an unrecognized non-empty value THROWS (fail-closed —
// a typo must never silently resolve to a state the operator did not ask
// for). Production ships with none of these set: every family record-only.

/** Per-family cutover state (phase BQC-3 §7 record-only/shadow/switch). */
export type CutoverState = 'record-only' | 'shadow' | 'switch'

/** The inbox projection families that cut over to durable dispatch. */
export const INBOX_CUTOVER_FAMILIES = [
  'review.created',
  'review.updated',
  'review.expired',
  'review.reply.published',
] as const

export type CutoverFamily = (typeof INBOX_CUTOVER_FAMILIES)[number]

/** A family that has left record-only, with its resolved state. */
export type ActiveCutoverFamily = Readonly<{
  family: CutoverFamily
  state: Exclude<CutoverState, 'record-only'>
}>

type EnvLike = Readonly<Record<string, string | undefined>>

/** Group-level env var applied to every family without a per-family override. */
const GROUP_CUTOVER_ENV_VAR = 'DURABLE_CUTOVER_INBOX'

/** The per-family env var name (e.g. DURABLE_CUTOVER_INBOX_REVIEW_CREATED). */
export function cutoverEnvVarFor(family: CutoverFamily): string {
  return `DURABLE_CUTOVER_INBOX_${family.replaceAll('.', '_').toUpperCase()}`
}

function parseCutoverValue(varName: string, raw: string): CutoverState {
  const value = raw.trim().toLowerCase()
  if (value === 'record-only' || value === 'shadow' || value === 'switch') return value
  throw new Error(
    `[CONFIG] Invalid durable cutover state '${raw}' in ${varName} — ` +
      "expected 'record-only', 'shadow', or 'switch'",
  )
}

/**
 * Resolve one family's cutover state: per-family var, then the group var,
 * then 'record-only'. Empty/whitespace values fall through to the next level.
 */
export function resolveCutoverState(
  family: CutoverFamily,
  env: EnvLike = process.env,
): CutoverState {
  const familyRaw = env[cutoverEnvVarFor(family)]
  if (familyRaw != null && familyRaw.trim() !== '') {
    return parseCutoverValue(cutoverEnvVarFor(family), familyRaw)
  }
  const groupRaw = env[GROUP_CUTOVER_ENV_VAR]
  if (groupRaw != null && groupRaw.trim() !== '') {
    return parseCutoverValue(GROUP_CUTOVER_ENV_VAR, groupRaw)
  }
  return 'record-only'
}

/**
 * Families that have left record-only (shadow or switch), in catalogue order.
 * The 3.6 readiness gate requires OUTBOX_DISPATCHER_ENABLED when this is
 * non-empty; the inbox handler registration consults it per family.
 */
export function listActiveCutoverFamilies(
  env: EnvLike = process.env,
): ReadonlyArray<ActiveCutoverFamily> {
  const active: ActiveCutoverFamily[] = []
  for (const family of INBOX_CUTOVER_FAMILIES) {
    const state = resolveCutoverState(family, env)
    if (state !== 'record-only') active.push({ family, state })
  }
  return active
}
