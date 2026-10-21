import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actionErrorMessage,
  GENERIC_ACTION_ERROR_MESSAGE,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import type {
  InboxGoogleCheckOutcome,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import {
  GOOGLE_CHECK_COPY,
  sayGoogleCheck,
  type GoogleCheckSource,
} from './google-check-copy'
import {
  createReturnWatcher,
  type ReturnWatcher,
  type ReturnWatcherEnv,
} from './google-return-watcher'
import { rereadAfterGoogleReplyFound } from './inbox-google-check-cache'
import type { InboxServerFns } from './types'

/** What the Inbox detail pane needs to offer "Check on Google". */
export type GoogleReviewCheck = Readonly<{
  /** Offer the action: a Google review item, a server that can check it, not known unchecked. */
  available: boolean
  /** THIS review's check is running, whoever started it. */
  isChecking: boolean
  /** The manager's own "Check on Google": answers in a toast; resolves once it has. */
  check: () => Promise<void>
  /** The manager chose a way to Google for this review: watch for their return. */
  noteOpenedGoogle: () => void
}>

type Input = Readonly<{
  /** The open item, or null when none is. */
  item: InboxItem | null
  checkReviewOnGoogle: InboxServerFns['checkReviewOnGoogle']
  /** The page's own clock, timers and visibility; tests pass a fake page. */
  env?: ReturnWatcherEnv
}>

/** The browser page: wall clock, its timers, and `visibilitychange`. */
const browserReturnEnv: ReturnWatcherEnv = {
  now: () => Date.now(),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  isVisible: () => document.visibilityState === 'visible',
  onVisible: (listener) => {
    const onChange = () => {
      if (document.visibilityState === 'visible') listener()
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  },
}

const GOOGLE_PLATFORM = 'google'

/** A refusal keeps the server's words; anything else is "couldn't check right now". */
function failureMessage(error: unknown): string {
  const message = actionErrorMessage(error)
  return message === GENERIC_ACTION_ERROR_MESSAGE
    ? GOOGLE_CHECK_COPY.unavailable
    : message
}

/** The outcomes after which there is nothing more to check. */
const isOver = (outcome: InboxGoogleCheckOutcome): boolean =>
  outcome === 'reply_found' || outcome === 'not_checkable'

/**
 * Check a review on Google: for the manager's "Check on Google" and for the
 * automatic check when they come back from "Open on Google"
 * (`google-return-watcher.ts`). One check runs at a time per pane, so a click
 * and a return that coincide are one read.
 *
 * A reply found closes the item through the event path (Review records the
 * observation, Inbox's consumer closes it); this only re-reads the item
 * afterwards (`rereadAfterGoogleReplyFound`). A review the server says
 * cannot be checked stops offering the action for the rest of the session.
 */
export function useGoogleReviewCheck(input: Input): GoogleReviewCheck {
  const { item, checkReviewOnGoogle, env } = input
  const qc = useQueryClient()
  const [unchecked, setUnchecked] = useState<ReadonlyArray<string>>([])
  const [checkingReviewId, setCheckingReviewId] = useState<string | null>(null)
  const inFlight = useRef(false)
  const callServer = useActionMutation(
    checkReviewOnGoogle ??
      (() => Promise.reject(new Error('Checking Google is not offered here.'))),
  )

  const reviewId =
    item?.sourceType === 'review' && item.platform === GOOGLE_PLATFORM
      ? item.sourceId
      : null
  const itemId = item?.id ?? null
  const itemIsOpen = item?.status === 'open'
  const available =
    checkReviewOnGoogle !== undefined &&
    reviewId !== null &&
    !unchecked.includes(reviewId)

  const run = useCallback(
    async (source: GoogleCheckSource): Promise<boolean> => {
      if (!available || reviewId === null || itemId === null) return false
      if (inFlight.current) return false
      inFlight.current = true
      setCheckingReviewId(reviewId)
      try {
        const { outcome } = await callServer({ data: { reviewId } })
        const say = sayGoogleCheck(outcome, source, itemIsOpen)
        if (say !== null) toast[say.tone](say.message)
        if (outcome === 'reply_found') rereadAfterGoogleReplyFound(qc, itemId)
        if (outcome === 'not_checkable') {
          setUnchecked((current) => [...current, reviewId])
        }
        return isOver(outcome)
      } catch (error) {
        // The manager asked, so they are told; a failed automatic check stays quiet.
        if (source === 'manual') toast.error(failureMessage(error))
        return false
      } finally {
        inFlight.current = false
        setCheckingReviewId(null)
      }
    },
    [available, callServer, itemId, itemIsOpen, qc, reviewId],
  )

  // The watcher is built once and always calls the latest `run`.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  const watcherRef = useRef<ReturnWatcher | null>(null)
  useEffect(() => {
    const watcher = createReturnWatcher({
      env: env ?? browserReturnEnv,
      check: () => runRef.current('return'),
    })
    watcherRef.current = watcher
    return () => {
      watcher.dispose()
      watcherRef.current = null
    }
  }, [env])

  // Only an open item that can still be checked is worth watching.
  const watchedReviewId = available && itemIsOpen ? reviewId : null
  useEffect(() => {
    watcherRef.current?.focus(watchedReviewId)
  }, [watchedReviewId, env])

  return {
    available,
    isChecking: reviewId !== null && checkingReviewId === reviewId,
    check: () => run('manual').then(() => undefined),
    noteOpenedGoogle: () => {
      if (reviewId !== null) watcherRef.current?.opened(reviewId)
    },
  }
}
