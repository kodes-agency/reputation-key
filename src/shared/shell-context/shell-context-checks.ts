// How `_authenticated`'s `beforeLoad` gets its three answers (ADR 0072).
//
// The server always asks: its QueryClient is made per request and nothing here is
// written to it, so one request's answer can never reach another request, or ride the
// dehydrated cache into a browser. The browser remembers a POSITIVE session, an
// Organization answer that lets the person in, and the capability set per Property
// scope for `SHELL_CONTEXT_STALE_MS` (`shell-context-cache.ts`), so a navigation soon
// after the last check costs no request and a later one asks as before, blocking.
//
// This module only fetches and remembers. The decisions (no session, then an
// Organization failure, then a capability redirect) stay in `_authenticated.tsx`, in
// their order, and see exactly what the server said, or what it said a moment ago.
// The server functions are passed in, so this module adds no server code to first
// paint and the policy is tested without them.

import type { QueryClient } from '@tanstack/react-query'
import { httpStatus } from '#/shared/security/expected-refusal'
import type { CapabilitySet } from '#/shared/auth/capability-set'
import {
  SHELL_CONTEXT_STALE_MS,
  shellContextGeneration,
  shellContextKeys,
} from '#/shared/queries/shell-context-cache'

export type Settled<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>

/**
 * Waits for `promise` without letting it reject: the shell asks three questions at
 * once, and a rejection of one that is left waiting while another is awaited would be
 * an unhandled rejection. Each answer is read in the order the rules need it, not in
 * the order the answers arrive.
 */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  )
}

type SignedInSession = Readonly<{ user: Readonly<{ id: string }> }>

export type ShellCheckFns<S extends SignedInSession, O> = Readonly<{
  session: () => Promise<S | null | undefined>
  organization: () => Promise<O>
  capabilities: (propertyId: string | null) => Promise<CapabilitySet>
  /**
   * Whether an Organization answer lets the person into the shell. Only those are
   * remembered: a disabled workspace or a missing Organization is asked again on the
   * next navigation, so access granted a moment later is seen at once.
   */
  admitsShell: (organization: O) => boolean
}>

export type ShellChecks<S, O> = Readonly<{
  session: Settled<S | null | undefined>
  organization: Settled<O>
  capabilities: Settled<CapabilitySet>
}>

export type ShellCheckRequest<S extends SignedInSession, O> = Readonly<{
  queryClient: QueryClient
  propertyId: string | null
  /** `server` always fetches and writes nothing. */
  side: 'server' | 'browser'
  fns: ShellCheckFns<S, O>
}>

const UNAUTHENTICATED = 401

/** The three questions at once, as the shell asked them before it remembered any. */
async function askServer<S extends SignedInSession, O>(
  fns: ShellCheckFns<S, O>,
  propertyId: string | null,
): Promise<ShellChecks<S, O>> {
  const [session, organization, capabilities] = await Promise.all([
    settle(fns.session()),
    settle(fns.organization()),
    settle(fns.capabilities(propertyId)),
  ])
  return { session, organization, capabilities }
}

function forgetAll(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: shellContextKeys.all })
}

/** A 401 from any of the three: the session ended, so nothing remembered stands. */
function anySignedOut(checks: ShellChecks<unknown, unknown>): boolean {
  return [checks.session, checks.organization, checks.capabilities].some(
    (answer) => !answer.ok && httpStatus(answer.error) === UNAUTHENTICATED,
  )
}

/** The remembered session, only while it is fresh. */
function freshSession<S extends SignedInSession>(queryClient: QueryClient): S | null {
  const query = queryClient
    .getQueryCache()
    .find<S>({ queryKey: shellContextKeys.session(), exact: true })
  if (!query || query.isStaleByTime(SHELL_CONTEXT_STALE_MS)) return null
  return query.state.data ?? null
}

/**
 * Keep what the server just said, under the person it said it about. A missing or
 * failed session is never kept, and with it goes everything else; a new person's
 * session replaces the old person's entries rather than sitting beside them.
 */
function remember<S extends SignedInSession, O>(
  queryClient: QueryClient,
  propertyId: string | null,
  checks: ShellChecks<S, O>,
  admitsShell: (organization: O) => boolean,
): void {
  const session = checks.session.ok ? checks.session.value : null
  if (!session || anySignedOut(checks)) {
    forgetAll(queryClient)
    return
  }
  const userId = session.user.id
  const previous = queryClient.getQueryData<S>(shellContextKeys.session())
  if (previous && previous.user.id !== userId) forgetAll(queryClient)
  queryClient.setQueryData(shellContextKeys.session(), session)
  if (checks.organization.ok && admitsShell(checks.organization.value)) {
    queryClient.setQueryData(
      shellContextKeys.organization(userId),
      checks.organization.value,
    )
  } else {
    queryClient.removeQueries({ queryKey: shellContextKeys.organization(userId) })
  }
  if (checks.capabilities.ok) {
    queryClient.setQueryData(
      shellContextKeys.capabilities(userId, propertyId),
      checks.capabilities.value,
    )
  }
}

/** The Organization and capability set for a person whose session is still fresh. */
async function askForPerson<S extends SignedInSession, O>(
  request: ShellCheckRequest<S, O>,
  session: S,
): Promise<ShellChecks<S, O>> {
  const { queryClient, propertyId, fns } = request
  const userId = session.user.id
  const organizationKey = shellContextKeys.organization(userId)
  // `retry: false`, as the server calls were: a failure is decided at once, never
  // retried behind the person's click. A rejected fetch keeps no data, so it is
  // asked again next time.
  const [organization, capabilities] = await Promise.all([
    settle(
      queryClient.fetchQuery({
        queryKey: organizationKey,
        queryFn: fns.organization,
        staleTime: SHELL_CONTEXT_STALE_MS,
        retry: false,
      }),
    ),
    settle(
      queryClient.fetchQuery({
        queryKey: shellContextKeys.capabilities(userId, propertyId),
        queryFn: () => fns.capabilities(propertyId),
        staleTime: SHELL_CONTEXT_STALE_MS,
        retry: false,
      }),
    ),
  ])
  const checks: ShellChecks<S, O> = {
    session: { ok: true, value: session },
    organization,
    capabilities,
  }
  if (anySignedOut(checks)) forgetAll(queryClient)
  else if (!organization.ok || !fns.admitsShell(organization.value)) {
    queryClient.removeQueries({ queryKey: organizationKey })
  }
  return checks
}

/**
 * The browser's checks still in flight, per QueryClient and Property scope. A hover
 * preload and the click that follows it run `beforeLoad` a moment apart; with no fresh
 * session both would ask all three, so the second waits for the first's answers. Only
 * a question asked at the same moment is shared, never a settled answer.
 */
const inFlight = new WeakMap<
  QueryClient,
  Map<
    string,
    Readonly<{ generation: number; asking: Promise<ShellChecks<unknown, unknown>> }>
  >
>()

function askAndRemember<S extends SignedInSession, O>(
  request: ShellCheckRequest<S, O>,
): Promise<ShellChecks<S, O>> {
  const { queryClient, propertyId, fns } = request
  const pending = inFlight.get(queryClient) ?? new Map()
  inFlight.set(queryClient, pending)
  const scope = propertyId ?? ''
  const generation = shellContextGeneration(queryClient)
  const shared = pending.get(scope)
  // Asked before the shell was last forgotten: not shared, it may be the old answer.
  if (shared?.generation === generation)
    return shared.asking as Promise<ShellChecks<S, O>>
  const asking = askServer(fns, propertyId).then((checks) => {
    // Forgotten while asking (a sign-out, a profile save): this answer is from before.
    if (shellContextGeneration(queryClient) === generation) {
      remember(queryClient, propertyId, checks, fns.admitsShell)
    }
    return checks
  })
  pending.set(scope, { generation, asking })
  void asking.finally(() => {
    if (pending.get(scope)?.asking === asking) pending.delete(scope)
  })
  return asking
}

/**
 * The session, the Organization and the capability set for this navigation. On the
 * server, and in the browser when the remembered session is missing or stale, all
 * three are asked in one stage, exactly as before; in the browser with a fresh
 * session, the Organization and capability set come from their own entries, each
 * asked again only when stale.
 */
export async function readShellChecks<S extends SignedInSession, O>(
  request: ShellCheckRequest<S, O>,
): Promise<ShellChecks<S, O>> {
  const { queryClient, propertyId, side, fns } = request
  if (side === 'server') return askServer(fns, propertyId)
  const session = freshSession<S>(queryClient)
  if (session) return askForPerson(request, session)
  return askAndRemember(request)
}
