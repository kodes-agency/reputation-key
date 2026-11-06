import { WORK_DISPATCH_BATCH_SIZE } from '#/shared/db/work-items.server'

export {
  createWorkItems,
  type WorkItems,
  type WorkRequest,
} from '#/shared/db/work-items.server'

export function isWorkItemJob(job: Readonly<{ data: unknown }>): boolean {
  const data = job.data
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    'workId' in data &&
    typeof data.workId === 'string' &&
    data.workId.length > 0
  )
}

type Dispatch = Readonly<{ id: string; kind: string; dispatchSequence: number }>

export async function reconcileWorkItems(
  input: Readonly<{
    reserveDispatch: (dispatchBefore: Date) => Promise<readonly Dispatch[]>
    enqueue: (
      kind: string,
      data: Readonly<{ workId: string }>,
      jobId: string,
    ) => Promise<unknown>
    clock?: () => Date
  }>,
) {
  const dispatchBefore = (input.clock ?? (() => new Date()))()
  let queued = 0
  let failed = 0
  // Bound each pass to 20,000 deliveries. A fixed cutoff
  // keeps a slow pass from reserving its own deliveries again after a minute.
  for (let batch = 0; batch < 200; batch++) {
    const due = await input.reserveDispatch(dispatchBefore)
    // A failed enqueue has a durable next dispatch time and spends no attempt.
    for (let offset = 0; offset < due.length; offset += 10) {
      await Promise.all(
        due.slice(offset, offset + 10).map(async (work) => {
          try {
            await input.enqueue(
              work.kind,
              { workId: work.id },
              `${work.id}-${work.dispatchSequence}`,
            )
            queued++
          } catch {
            failed++
          }
        }),
      )
    }
    if (due.length < WORK_DISPATCH_BATCH_SIZE) break
  }
  return { queued, failed }
}

export function startWorkItemReconciler(
  input: Readonly<{
    reconcile: () => Promise<unknown>
    onError: (error: unknown) => void
  }>,
): () => Promise<void> {
  let inFlight: Promise<void> | undefined
  const tick = () => {
    inFlight ??= input
      .reconcile()
      .then(() => undefined)
      .catch(input.onError)
      .finally(() => {
        inFlight = undefined
      })
  }
  tick()
  const timer = setInterval(tick, 60_000)
  return async () => {
    clearInterval(timer)
    await inFlight
  }
}
