// The browser's memory of the shell's own checks (ADR 0072).
//
// `_authenticated`'s `beforeLoad` asks who is signed in, which Organization and role
// they have, and which features are on for the Property in scope, and the controlled
// routes ask whether their feature is on. Those answers are kept in the browser's
// Query cache for `SHELL_CONTEXT_STALE_MS`, so a navigation soon after the last check
// asks the server nothing. This module holds the keys and the ways an entry is
// forgotten. It imports nothing but Query's types, because the shell and the route
// error boundary both load it in first paint.
//
// The server never reads these entries: its QueryClient is made per request
// (`getRouter`), and the shell's server path fetches and writes nothing.

import type { QueryClient } from '@tanstack/react-query'

/** How long a check answers for the next navigations. */
export const SHELL_CONTEXT_STALE_MS = 30_000

/**
 * The session is the one entry not under a person: it is the answer to who the person
 * is. Every other entry is under the user id that answer gave, so one person's role,
 * Organization or feature answer can never be read for another.
 */
export const shellContextKeys = {
  all: ['shell-context'] as const,
  session: () => [...shellContextKeys.all, 'session'] as const,
  person: (userId: string) => [...shellContextKeys.all, 'person', userId] as const,
  organization: (userId: string) =>
    [...shellContextKeys.person(userId), 'organization'] as const,
  capabilities: (userId: string, propertyId: string | null) =>
    [...shellContextKeys.person(userId), 'capabilities', propertyId ?? 'none'] as const,
  routeGate: (userId: string, capability: string, propertyId: string | null) =>
    [
      ...shellContextKeys.person(userId),
      'route-gate',
      capability,
      propertyId ?? 'none',
    ] as const,
}

type ForgettingClient = Pick<QueryClient, 'removeQueries'>

const CHANNEL_NAME = 'repkey-shell-context'
/** The shell's own entries are stale (a profile save, a role change, a refusal). */
const FORGET_MESSAGE = 'forget'
/** Who is here changed (sign-in, sign-out, a new Organization): nothing cached stands. */
const TENANT_CHANGED_MESSAGE = 'tenant-changed'

/**
 * How many times this QueryClient's shell checks were forgotten. A check asked before
 * a forget may answer after it, with what was true before the change; whoever
 * remembers an answer compares this number from before the ask with the one after,
 * and keeps nothing when they differ.
 */
const generations = new WeakMap<object, number>()

export function shellContextGeneration(queryClient: object): number {
  return generations.get(queryClient) ?? 0
}

/** The last person a shell check named, kept across forgets so a switch is noticed. */
const lastSignedInUsers = new WeakMap<object, string>()

/**
 * Notes who the shell was last answered for. True when that is a different person
 * than the one before: the caller must then drop everything else the client holds,
 * which is the previous person's (a tab that came back after another tab switched
 * accounts has no sign-in of its own to have cleared it). The switch also moves the
 * generation on, so a check still in flight for the previous person is not kept. Other
 * tabs are not told: they were told by the tab that signed in.
 */
export function noteSignedInUser(queryClient: object, userId: string): boolean {
  const previous = lastSignedInUsers.get(queryClient)
  lastSignedInUsers.set(queryClient, userId)
  const switched = previous !== undefined && previous !== userId
  if (switched) generations.set(queryClient, shellContextGeneration(queryClient) + 1)
  return switched
}

function forgetHere(queryClient: ForgettingClient): void {
  queryClient.removeQueries({ queryKey: shellContextKeys.all })
  generations.set(queryClient, shellContextGeneration(queryClient) + 1)
}

function announce(message: string): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage(message)
  channel.close()
}

/**
 * Who is here, or what they may do, changed in a way that already emptied the cache
 * (`queryClient.clear()` on sign-in and sign-out): stop any check still in flight
 * from being remembered, and tell the person's other tabs, which drop everything they
 * hold (not only the shell's entries: their pages' data is the previous person's) and
 * reload the page they are on.
 */
export function shellContextForgotten(queryClient: object): void {
  generations.set(queryClient, shellContextGeneration(queryClient) + 1)
  announce(TENANT_CHANGED_MESSAGE)
}

/**
 * Forget every remembered shell check, in this tab and the person's other tabs, so the
 * next navigation asks the server. Call it after anything the shell shows or decides
 * from changes: the person's name or picture, the Organization's name, a member's role
 * or Property access, an active Organization being set, a refusal. Removed rather than
 * marked stale, so nothing can read them afterwards.
 */
export function invalidateShellContext(queryClient: ForgettingClient): void {
  forgetHere(queryClient)
  announce(FORGET_MESSAGE)
}

let stopListening: (() => void) | undefined

/**
 * Forget the entries whenever this tab may have missed a change: when it becomes
 * visible again (another tab may have signed out, or in as someone else, while it was
 * hidden) and when another tab announces one. A tenant change also runs
 * `onTenantChanged`, which drops the rest of the tab's data. Browser only; returns the
 * unsubscribe. A second call (a hot reload) replaces the first listener.
 */
export function forgetShellContextOnReturn(
  queryClient: ForgettingClient,
  onTenantChanged: () => void = () => undefined,
): () => void {
  stopListening?.()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') forgetHere(queryClient)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === FORGET_MESSAGE) forgetHere(queryClient)
      if (event.data === TENANT_CHANGED_MESSAGE) {
        forgetHere(queryClient)
        onTenantChanged()
      }
    }
  }
  const stop = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    channel?.close()
    if (stopListening === stop) stopListening = undefined
  }
  stopListening = stop
  return stop
}

/**
 * Which side a route option runs on. Only the browser remembers: the server answers
 * one request and must never answer the next from it.
 */
export function shellCheckSide(): 'server' | 'browser' {
  return typeof document === 'undefined' ? 'server' : 'browser'
}
