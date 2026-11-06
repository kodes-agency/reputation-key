export {
  createWorkItems,
  type WorkItems,
  type WorkRequest,
} from '#/shared/db/work-items.server'

type Dispatch = Readonly<{ id: string; kind: string; dispatchSequence: number }>

export async function reconcileWorkItems(
  input: Readonly<{
    reserveDispatch: () => Promise<readonly Dispatch[]>
    enqueue: (
      kind: string,
      data: Readonly<{ workId: string }>,
      jobId: string,
    ) => Promise<unknown>
  }>,
) {
  const due = await input.reserveDispatch()
  let queued = 0
  let failed = 0
  // Bound transport concurrency. A failed enqueue already has a durable next
  // dispatch time; acceptance (including ambiguous acceptance) spends no attempt.
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
