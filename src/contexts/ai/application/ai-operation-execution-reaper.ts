// AI operation — abandoned-execution reaper.
//
// `claimExecution` moves an operation to `executing` and the request path is
// the only thing that writes a terminal state afterwards. Anything that kills
// that path between the two — a crashed worker, a dropped request, a rejected
// terminal write — leaves the row `executing` with nobody left to finish it.
//
// Nothing recovered those rows. `claim` refuses operations past `expires_at`,
// so an abandoned row can never be re-claimed either: it is inert, permanent,
// and still counted as in-flight AI work. Observed in the closed beta after a
// constraint violation made the terminal write throw: six operations across two
// reviews sat `executing` indefinitely while their permits had long since
// settled.
//
// Recovery is bounded by the operation's own horizon instead:
//
//   - selects rows still `executing` with an elapsed `expires_at`;
//   - settles each through the existing `recordFailure`, with no retry, so the
//     open attempt row is closed and the operation reaches `failed`.
//
// The failure code is `operation_ambiguous` and that is the honest one: the
// provider may well have run and been charged before the owner vanished, and
// from here that is unknowable. Nothing is retried for exactly that reason —
// re-running an operation whose provider call may have succeeded is how you
// bill a merchant twice for one reply.
//
// `recordFailure` carries the CAS (state `executing` AND the exact attempt), so
// the scan above may be lock-free and slightly stale: a row that settles
// between the scan and the write loses the CAS and is counted as raced, never
// overwritten.

import type { AiOperationStorePort } from './ports/ai-operation-store.port'

export const AI_EXECUTION_REAPER_BATCH_SIZE = 100

type ExecutionReaperStore = Pick<
  AiOperationStorePort,
  'listExpiredExecutions' | 'recordFailure'
>

export type AiOperationExecutionReaperResult = Readonly<{
  /** Rows the bounded scan returned. */
  abandonedVisited: number
  /** Rows this run drove to `failed`. */
  operationsFenced: number
  /** Rows that settled under us between the scan and the write. */
  operationsRaced: number
  /** The scan filled its batch, so a backlog remains for the next tick. */
  batchFull: boolean
}>

export type AiOperationExecutionReaper = () => Promise<AiOperationExecutionReaperResult>

export function createAiOperationExecutionReaper(
  deps: Readonly<{
    store: ExecutionReaperStore
    nowEpochMillis: () => number
    limit?: number
  }>,
): AiOperationExecutionReaper {
  const limit = deps.limit ?? AI_EXECUTION_REAPER_BATCH_SIZE

  return async () => {
    const nowEpochMillis = deps.nowEpochMillis()
    const abandoned = await deps.store.listExpiredExecutions({ nowEpochMillis, limit })
    let operationsFenced = 0
    let operationsRaced = 0

    for (const candidate of abandoned) {
      const fenced = await deps.store.recordFailure({
        operationId: candidate.operationId,
        expectedAttempt: candidate.attempt,
        failureCode: 'operation_ambiguous',
        // Terminal on purpose. See the header: the provider may already have
        // run, so a retry risks a second billed call for one request.
        retryAtEpochMillis: null,
        failedAtEpochMillis: nowEpochMillis,
      })
      if (fenced) operationsFenced += 1
      else operationsRaced += 1
    }

    return Object.freeze({
      abandonedVisited: abandoned.length,
      operationsFenced,
      operationsRaced,
      batchFull: abandoned.length >= limit,
    })
  }
}
