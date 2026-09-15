import type { CurrentMerchantAiCapability } from '#/contexts/identity/application/public-api'
import type { SetupPlan } from './setup-plan'

export type SetupTaskKind = 'language' | 'managers' | 'ai'

/** The writes the step performs, bound by the caller to the server functions. */
export type SetupWriteFns = Readonly<{
  /** One consent ceremony for every property whose AI is enabled (decision 3). */
  enableAi: (
    input: Readonly<{
      propertyIds: string[]
      capabilities: CurrentMerchantAiCapability[]
      acknowledgement: Readonly<{ noticeVersion: string; noticeDigest: string }>
      idempotencyKey: string
    }>,
  ) => Promise<unknown>
  deferAi: (input: Readonly<{ propertyId: string }>) => Promise<unknown>
  setLanguage: (
    input: Readonly<{ propertyId: string; language: string }>,
  ) => Promise<unknown>
  setManagers: (
    input: Readonly<{ propertyId: string; managerIds: readonly string[] }>,
  ) => Promise<unknown>
}>

export type SetupTaskResult = Readonly<{
  propertyId: string
  kind: SetupTaskKind
  outcome: 'saved' | 'failed'
  message: string | null
}>

export type RunSetupPlanOptions = Readonly<{
  acknowledgement: Readonly<{ noticeVersion: string; noticeDigest: string }> | null
  /** Reused on a retry, so a ceremony that committed replays instead of repeating. */
  aiIdempotencyKey: string
  /** Restrict a retry to the tasks that failed. */
  include?: (propertyId: string, kind: SetupTaskKind) => boolean
  concurrency?: number
}>

const DEFAULT_CONCURRENCY = 4

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'This setting could not be saved.'
}

async function settle(
  task: Readonly<{ propertyId: string; kind: SetupTaskKind }>,
  write: () => Promise<unknown>,
): Promise<SetupTaskResult> {
  try {
    await write()
    return { ...task, outcome: 'saved', message: null }
  } catch (error) {
    return { ...task, outcome: 'failed', message: failureMessage(error) }
  }
}

async function runPooled<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const index = next
      next += 1
      results[index] = await jobs[index]!()
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker),
  )
  return results
}

async function runAiCeremony(
  plan: SetupPlan,
  fns: SetupWriteFns,
  options: RunSetupPlanOptions,
  include: (propertyId: string, kind: SetupTaskKind) => boolean,
): Promise<SetupTaskResult[]> {
  const propertyIds = plan.properties
    .filter((property) => property.ai === 'enable' && include(property.propertyId, 'ai'))
    .map((property) => property.propertyId)
  if (propertyIds.length === 0) return []
  const acknowledgement = options.acknowledgement
  const outcome: SetupTaskResult = acknowledgement
    ? await settle({ propertyId: '', kind: 'ai' }, () =>
        fns.enableAi({
          propertyIds,
          capabilities: [...plan.aiCapabilities],
          acknowledgement,
          idempotencyKey: options.aiIdempotencyKey,
        }),
      )
    : {
        propertyId: '',
        kind: 'ai',
        outcome: 'failed',
        message: 'Agree to the AI data use notice to turn on AI features.',
      }
  return propertyIds.map((propertyId) => ({ ...outcome, propertyId }))
}

/**
 * Perform every write the plan holds and report each one. The AI ceremony
 * runs first as one request; deferrals, reply languages and managers follow
 * with bounded concurrency. A failure never stops the other writes.
 */
export async function runSetupPlan(
  plan: SetupPlan,
  fns: SetupWriteFns,
  options: RunSetupPlanOptions,
): Promise<readonly SetupTaskResult[]> {
  const include = options.include ?? (() => true)
  const ceremony = await runAiCeremony(plan, fns, options, include)
  const jobs = plan.properties.flatMap((property) => {
    const { propertyId } = property
    const tasks: (() => Promise<SetupTaskResult>)[] = []
    if (property.ai === 'defer' && include(propertyId, 'ai')) {
      tasks.push(() =>
        settle({ propertyId, kind: 'ai' }, () => fns.deferAi({ propertyId })),
      )
    }
    const language = property.language
    if (language !== null && include(propertyId, 'language')) {
      tasks.push(() =>
        settle({ propertyId, kind: 'language' }, () =>
          fns.setLanguage({ propertyId, language }),
        ),
      )
    }
    const managerIds = property.managerIds
    if (managerIds !== null && include(propertyId, 'managers')) {
      tasks.push(() =>
        settle({ propertyId, kind: 'managers' }, () =>
          fns.setManagers({ propertyId, managerIds }),
        ),
      )
    }
    return tasks
  })
  const rest = await runPooled(jobs, options.concurrency ?? DEFAULT_CONCURRENCY)
  return [...ceremony, ...rest]
}

export function failedSetupTasks(
  results: readonly SetupTaskResult[],
): readonly SetupTaskResult[] {
  return results.filter((result) => result.outcome === 'failed')
}

/** Merge a retry's results over the previous run's, task by task. */
export function mergeSetupResults(
  previous: readonly SetupTaskResult[],
  retry: readonly SetupTaskResult[],
): readonly SetupTaskResult[] {
  const key = (result: SetupTaskResult) => `${result.propertyId}:${result.kind}`
  const retried = new Map(retry.map((result) => [key(result), result]))
  const merged = previous.map((result) => retried.get(key(result)) ?? result)
  const known = new Set(previous.map(key))
  return [...merged, ...retry.filter((result) => !known.has(key(result)))]
}
