// The guarded half of a route error boundary, in one place.
//
// Every boundary must:
//
//   - show `publicErrorMessage`, generic in production (no raw SQL, path or secret
//     text in the DOM) unless the page gave a sentence;
//   - report an unexpected failure with `captureBrowserException`, and stay quiet
//     for an expected 4xx refusal;
//   - send a 401 to /login: an expired session under an open page is not a failure;
//   - offer "Try again", which re-runs the route's loaders (`useReadRetry`);
//   - load the page afresh, once and silently, when the failure means this tab's
//     code is older than the server's (a refused read, a chunk a deploy removed).
//
// Boundaries take this behaviour from here and keep only their own frame (title,
// breadcrumbs, tier). PageState builds on this hook.
import { useEffect } from 'react'
import { Navigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useReadRetry } from '#/components/hooks/use-read-retry'
import {
  GENERIC_CLIENT_ERROR_MESSAGE,
  publicErrorMessage,
} from '#/shared/security/error-display'
import { captureBrowserException } from '#/shared/observability/browser-exception-capture'
import { httpStatus, isExpectedRefusal } from '#/shared/security/expected-refusal'
import { staleTab } from '#/shared/stale-tab/stale-tab'
import { invalidateShellContext } from '#/shared/queries/shell-context-cache'

const UNAUTHENTICATED = 401
const FORBIDDEN = 403

export type RouteErrorFacts = Readonly<{
  /** The session ended under an open page: redirect to sign-in, show no error. */
  signedOut: boolean
  /**
   * The server refused the person (401) or what they asked for (403). The shell's
   * remembered checks are forgotten then (ADR 0072): the session, role or feature
   * they hold may be exactly what was refused.
   */
  refused: boolean
  /** The sentence to print. Never the raw message in production. */
  message: string
  /** Whether this failure is worth a report (not an expected 4xx refusal). */
  report: boolean
}>

/** What a boundary should do about `error`. Pure; `isProduction` is passed in. */
export function routeErrorFacts(
  error: unknown,
  isProduction: boolean,
  fallback: string = GENERIC_CLIENT_ERROR_MESSAGE,
): RouteErrorFacts {
  const status = httpStatus(error)
  return {
    signedOut: status === UNAUTHENTICATED,
    refused: status === UNAUTHENTICATED || status === FORBIDDEN,
    message: publicErrorMessage(error, isProduction, fallback),
    report: !isExpectedRefusal(error),
  }
}

export type GuardedRouteError = Readonly<{
  signedOut: boolean
  message: string
  /** Re-run the route's loaders. */
  retry: () => void
  /** The page is being loaded afresh; draw the loading state, not the error. */
  reloading: boolean
}>

/**
 * Guard a route error component: reports the error once and returns what to render.
 * When `signedOut` is true render `<SignedOutRedirect />` and nothing else.
 * `fallback` is a static sentence shown where the raw message may not be.
 */
export function useGuardedRouteError(
  error: unknown,
  fallback?: string,
): GuardedRouteError {
  const router = useRouter()
  const { tryAgain, reloading } = useReadRetry(() => void router.invalidate())
  const { signedOut, refused, message, report } = routeErrorFacts(
    error,
    import.meta.env.PROD,
    fallback,
  )

  const queryClient = useQueryClient()
  useEffect(() => {
    // A refusal wins over the shell's memory: later reads ask the server afresh.
    if (refused) invalidateShellContext(queryClient)
  }, [error, refused, queryClient])

  useEffect(() => {
    // Stale code is cured by reloading, not reported. If the guard refuses (just
    // reloaded, or a mutation is in flight) the tab stays armed for the next navigation.
    if (staleTab.reloadForFailure(error) === 'reloading') return
    if (report) captureBrowserException(error)
  }, [error, report])

  return { signedOut, message, retry: tryAgain, reloading }
}

/** The 401 outcome: sign in again, and come back to this page afterwards. */
export function SignedOutRedirect() {
  const router = useRouter()
  return (
    <Navigate to="/login" search={{ redirect: router.state.location.href }} replace />
  )
}
