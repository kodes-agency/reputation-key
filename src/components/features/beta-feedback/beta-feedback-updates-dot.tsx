import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'
import type { ListMyBetaFeedback } from './beta-feedback-form-context'
import {
  browserStorage,
  readSeenOutcomes,
  unseenOutcomes,
  updatesLabel,
} from './beta-feedback-updates'

type Props = Readonly<{
  listFeedback: ListMyBetaFeedback
  /** Bumped by the launcher whenever the reports panel records what was seen. */
  seenVersion: number
}>

/**
 * The marker on the Feedback entry point that says one of your reports reached
 * an outcome. Code-split from the launcher: the app shell mounts that on every
 * authenticated page and the initial bundle has almost no headroom left.
 *
 * It shares the reports panel's query key, so opening the panel reuses this
 * fetch and a submission's invalidation refreshes both.
 */
function BetaFeedbackUpdatesDot({ listFeedback, seenVersion }: Props) {
  const query = useQuery({
    queryKey: identityKeys.myBetaFeedback(),
    queryFn: () => listFeedback(),
    staleTime: 5 * 60_000,
  })

  const count = useMemo(() => {
    // `seenVersion` is the dependency that makes a fresh read of storage.
    void seenVersion
    return unseenOutcomes(query.data ?? [], readSeenOutcomes(browserStorage())).length
  }, [query.data, seenVersion])

  if (count === 0) return null

  return (
    <>
      {/* Joins the launcher's accessible name: "Feedback: … — 1 report updated". */}
      <span className="sr-only"> — {updatesLabel(count)}</span>
      <span
        aria-hidden="true"
        className="absolute top-1 right-1 size-2 rounded-full bg-primary"
      />
    </>
  )
}

export default BetaFeedbackUpdatesDot
