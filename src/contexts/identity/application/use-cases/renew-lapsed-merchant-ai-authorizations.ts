import type { LoggerPort } from '#/shared/domain/logger.port'
import type { MerchantAiNoticeReference } from '#/shared/merchant-ai-notice-contract'
import {
  standingRenewalKey,
  type StandingRenewalSkip,
} from '../../domain/merchant-ai-standing-renewal'

export type StandingRenewalCandidate = Readonly<{
  organizationId: string
  propertyId: string
  stateVersion: number
}>
export type StandingRenewalOutcome =
  | Readonly<{ status: 'renewed' }>
  | Readonly<{ status: 'skipped'; reason: StandingRenewalSkip }>
export type StandingRenewalStore = Readonly<{
  listLapsed(): Promise<readonly StandingRenewalCandidate[]>
  renew(
    input: StandingRenewalCandidate &
      Readonly<{
        ceremonyId: string
        now: Date
        idempotencyKey: string
      }>,
  ): Promise<StandingRenewalOutcome>
}>
type Deps = Readonly<{
  store: StandingRenewalStore
  target: MerchantAiNoticeReference
  clock: () => Date
  idGen: () => string
  logger: Pick<LoggerPort, 'info' | 'error'>
  captureUnexpected: (error: unknown) => void
}>

function failureCode(error: unknown): string {
  const failure = error as { code?: unknown; cause?: { code?: unknown } } | null
  const code = failure?.code ?? failure?.cause?.code
  return typeof code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(code)
    ? code
    : 'unexpected'
}

async function listCandidates(deps: Deps, ceremonyId: string) {
  try {
    return await deps.store.listLapsed()
  } catch (error) {
    deps.logger.error(
      { ceremonyId, outcome: `failed:${failureCode(error)}` },
      'Merchant AI standing renewal listing failed',
    )
    deps.logger.info(
      { ceremonyId, visited: 0, renewed: 0, skipped: 0, failed: 1 },
      'Merchant AI standing renewal sweep completed',
    )
    deps.captureUnexpected(error)
    throw error
  }
}

async function renewOne(
  deps: Deps,
  candidate: StandingRenewalCandidate,
  ceremonyId: string,
) {
  const fields = { ...candidate, ceremonyId }
  try {
    const outcome = await deps.store.renew({
      ...candidate,
      ceremonyId,
      now: deps.clock(),
      idempotencyKey: standingRenewalKey(candidate.propertyId, deps.target),
    })
    deps.logger.info(
      {
        ...fields,
        outcome: outcome.status === 'renewed' ? 'renewed' : `skipped:${outcome.reason}`,
      },
      'Merchant AI standing renewal',
    )
    return outcome.status
  } catch (error) {
    deps.logger.error(
      { ...fields, outcome: `failed:${failureCode(error)}` },
      'Merchant AI standing renewal',
    )
    deps.captureUnexpected(error)
    return 'failed' as const
  }
}

export const renewLapsedMerchantAiAuthorizations = (deps: Deps) => async () => {
  const ceremonyId = deps.idGen()
  const candidates = await listCandidates(deps, ceremonyId)
  const summary = {
    ceremonyId,
    visited: candidates.length,
    renewed: 0,
    skipped: 0,
    failed: 0,
  }
  for (const candidate of candidates)
    summary[await renewOne(deps, candidate, ceremonyId)]++
  deps.logger.info(summary, 'Merchant AI standing renewal sweep completed')
  return summary
}
