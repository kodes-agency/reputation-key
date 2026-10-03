// The guarded half of a route error boundary, in one place.
//
// The router's default error component does four things every boundary must:
//
//   - shows `publicErrorMessage`, which is generic in production (BQC-7.6: no raw
//     SQL, path or secret text in the DOM) and a page-written sentence if the
//     page gave one;
//   - reports an unexpected failure with `captureBrowserException`, and stays
//     quiet for an expected 4xx refusal;
//   - sends a 401 to /login, because that is an expired session under an open
//     page, not a failure;
//   - offers "Try again", which re-runs the route's loaders.
//
// Route-level error components (Portal list, All properties, Portal workspace)
// used to render `errorMessage(error)` and nothing else, so they lost all four.
// They, and the router default, now take their behaviour from here and keep only
// their own frame (title, breadcrumbs, tier). PageState builds on this hook.
import { useEffect } from 'react'
import { Navigate, useRouter } from '@tanstack/react-router'
import {
  GENERIC_CLIENT_ERROR_MESSAGE,
  publicErrorMessage,
} from '#/shared/security/error-display'
import { captureBrowserException } from '#/shared/observability/browser-exception-capture'
import { httpStatus, isExpectedRefusal } from '#/shared/security/expected-refusal'

const UNAUTHENTICATED = 401

export type RouteErrorFacts = Readonly<{
  /** The session ended under an open page: redirect to sign-in, show no error. */
  signedOut: boolean
  /** The sentence to print. Never the raw message in production. */
  message: string
  /** Whether this failure is worth a report (not an expected 4xx refusal). */
  report: boolean
}>

/**
 * What a boundary should do about `error`. Pure, so it is unit-tested without a
 * router; `isProduction` is passed in (the hook passes `import.meta.env.PROD`).
 */
export function routeErrorFacts(
  error: unknown,
  isProduction: boolean,
  fallback: string = GENERIC_CLIENT_ERROR_MESSAGE,
): RouteErrorFacts {
  return {
    signedOut: httpStatus(error) === UNAUTHENTICATED,
    message: publicErrorMessage(error, isProduction, fallback),
    report: !isExpectedRefusal(error),
  }
}

export type GuardedRouteError = Readonly<{
  signedOut: boolean
  message: string
  /** Re-run the route's loaders. */
  retry: () => void
}>

/**
 * Guard a route error component. Reports the error once per error, and returns
 * what to render. When `signedOut` is true render `<SignedOutRedirect />` and
 * nothing else.
 *
 * `fallback` is a static sentence for the page ("Portals could not be loaded.")
 * shown where the raw message may not be.
 */
export function useGuardedRouteError(
  error: unknown,
  fallback?: string,
): GuardedRouteError {
  const router = useRouter()
  const { signedOut, message, report } = routeErrorFacts(
    error,
    import.meta.env.PROD,
    fallback,
  )

  useEffect(() => {
    if (report) captureBrowserException(error)
  }, [error, report])

  return { signedOut, message, retry: () => void router.invalidate() }
}

/** The 401 outcome: sign in again, and come back to this page afterwards. */
export function SignedOutRedirect() {
  const router = useRouter()
  return (
    <Navigate to="/login" search={{ redirect: router.state.location.href }} replace />
  )
}
